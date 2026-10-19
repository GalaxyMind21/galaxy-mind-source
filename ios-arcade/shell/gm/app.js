/* Galaxy Mind arcade shell. Injected into every bundled game.
   Offline scores, external-link handoff, iPad touch, silent-switch hint.
   No network calls, no identifiers, no payment UI. */
(function () {
  var cfg = window.GM_CONFIG || { gameCenterEnabled: false, leaderboards: {} };
  window.GM_NATIVE = window.GM_NATIVE || { app: true, touch: true };

  /* Master mute. Games keep their own sound buttons. This one suspends
     every AudioContext and refuses resume until the player taps it
     again, so a mute survives a game that calls resume on its own. */
  var MUTE_KEY = "gm:native:mute";
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { muted = false; }
  var contexts = [];
  var origResume = null;

  function isMuted() { return muted; }

  function eachCtx(fn) {
    for (var i = 0; i < contexts.length; i++) {
      try { fn(contexts[i]); } catch (err) {}
    }
  }

  function wrapAudioCtor(name) {
    var Orig = window[name];
    if (!Orig || Orig.__gmWrapped) return;
    var resume = Orig.prototype.resume;
    if (!origResume) origResume = resume;
    function Wrapped() {
      var ctx = Reflect.construct(Orig, arguments, Wrapped);
      contexts.push(ctx);
      if (muted) ctx.suspend();
      return ctx;
    }
    Wrapped.prototype = Orig.prototype;
    Wrapped.__gmWrapped = true;
    try { Object.setPrototypeOf(Wrapped, Orig); } catch (err) {}
    window[name] = Wrapped;
    Orig.prototype.resume = function () {
      if (muted) return Promise.resolve();
      return resume.apply(this, arguments);
    };
  }
  wrapAudioCtor("AudioContext");
  wrapAudioCtor("webkitAudioContext");

  /* The WebView is already the whole screen. Element fullscreen puts the
     stage in the top layer, above the Games and mute buttons, so a tap
     on them hits the game instead. iOS refuses this API; match that. */
  function denyFullscreen() {
    return Promise.reject(new DOMException("Fullscreen is disabled in the app", "NotAllowedError"));
  }
  if (Element.prototype.requestFullscreen) Element.prototype.requestFullscreen = denyFullscreen;
  if (Element.prototype.webkitRequestFullscreen) Element.prototype.webkitRequestFullscreen = denyFullscreen;

  function setMuted(next) {
    muted = next;
    try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch (err) {}
    var btn = document.getElementById("gm-mute");
    if (btn) {
      btn.textContent = next ? "Off" : "\u266A";
      btn.setAttribute("aria-label", next ? "Unmute" : "Mute");
      btn.setAttribute("aria-pressed", next ? "true" : "false");
    }
    if (next) eachCtx(function (c) { c.suspend(); });
    else if (origResume) eachCtx(function (c) { origResume.call(c); });
  }

  document.addEventListener("pointerdown", function unlock(e) {
    var node = e.target;
    if (node && node.closest && node.closest("#gm-chrome, #gm-note")) return;
    if (muted) return;
    try {
      var session = navigator.audioSession;
      if (session) session.type = "playback";
    } catch (err) {}
    if (origResume) {
      eachCtx(function (c) {
        if (c.state === "suspended") origResume.call(c);
      });
    }
    document.removeEventListener("pointerdown", unlock, true);
  }, true);

  /* Backgrounding suspends sound. Coming back does not resume it:
     a paused race would start playing again. The game calls resume
     when it actually continues. WKWebView fires visibilitychange when
     the app backgrounds; Capacitor's App plugin is the same signal
     when it is installed. */
  function onBackground() {
    eachCtx(function (c) { c.suspend(); });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "hidden") return;
    onBackground();
  });
  function watchAppState() {
    var cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!cap || !cap.addListener || cap.__gmWatched) return;
    cap.__gmWatched = true;
    cap.addListener("appStateChange", function (state) {
      if (state && state.isActive === false) onBackground();
    }).catch(function () {});
  }
  watchAppState();
  document.addEventListener("DOMContentLoaded", watchAppState);

  var LOCAL_HOSTS = { localhost: 1, "capacitor.local": 1 };
  function isLocalHost(host) {
    if (!host) return true;
    host = host.toLowerCase();
    if (LOCAL_HOSTS[host]) return true;
    if (location.host && host === location.host.toLowerCase()) return true;
    return false;
  }

  /* iPadOS reports a fine pointer because a mouse can be attached, which
     hid on-screen controls in Bitcoin Kart and Super Saylor. Inside the
     app, a touch screen is the control surface. */
  var origMatch = window.matchMedia ? window.matchMedia.bind(window) : null;
  if (origMatch) {
    window.matchMedia = function (query) {
      var res = origMatch(query);
      var q = String(query);
      var force = function (matches) {
        return {
          matches: matches,
          media: res.media,
          onchange: null,
          addListener: function (fn) { if (res.addListener) res.addListener(fn); },
          removeListener: function (fn) { if (res.removeListener) res.removeListener(fn); },
          addEventListener: function (type, fn, opt) { res.addEventListener(type, fn, opt); },
          removeEventListener: function (type, fn, opt) { res.removeEventListener(type, fn, opt); },
          dispatchEvent: function (ev) { return res.dispatchEvent(ev); },
        };
      };
      if (q.indexOf("display-mode") !== -1 && q.indexOf("standalone") !== -1) return force(true);
      if (q.indexOf("pointer: coarse") !== -1) return force(true);
      if (q.indexOf("pointer: fine") !== -1) return force(false);
      if (q.indexOf("hover: none") !== -1) return force(true);
      if (q.indexOf("hover: hover") !== -1) return force(false);
      return res;
    };
  }

  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = function () { return Promise.resolve(); };
    } catch (e) { /* some engines freeze the method */ }
  }

  var SCORE_KEY = "gm:native:scores";
  var REVIEW_KEY = "gm:native:review";

  function loadScores() {
    try { return JSON.parse(localStorage.getItem(SCORE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function maybeReview() {
    var state;
    try { state = JSON.parse(localStorage.getItem(REVIEW_KEY) || "{}") || {}; }
    catch (e) { state = {}; }
    state.positives = (state.positives || 0) + 1;
    var last = state.lastAsk || 0;
    var wait = 90 * 24 * 60 * 60 * 1000;
    var plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GMBridge;
    if (state.positives >= 2 && Date.now() - last > wait && plugin && plugin.requestReview) {
      state.lastAsk = Date.now();
      try { localStorage.setItem(REVIEW_KEY, JSON.stringify(state)); } catch (e) {}
      plugin.requestReview().catch(function () {});
      return;
    }
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(state)); } catch (e2) {}
  }

  function recordScore(game, score) {
    if (typeof game !== "string" || !game) return;
    if (typeof score !== "number" || !isFinite(score)) return;
    var all = loadScores();
    var prev = all[game];
    var better = !prev || score > prev.score;
    if (!better) return;
    all[game] = { score: score, at: Date.now() };
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(all)); } catch (e) {}
    maybeReview();
    if (!cfg.gameCenterEnabled) return;
    var plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GMBridge;
    if (!plugin || !plugin.submitScore) return;
    var id = cfg.leaderboards && cfg.leaderboards[game];
    plugin.submitScore({ game: game, score: Math.round(score), leaderboardId: id || "" }).catch(function () {});
  }

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { "content-type": "application/json" },
    });
  }

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = "";
      var method = (init && init.method) || "GET";
      if (typeof input === "string") url = input;
      else if (input && input.url) {
        url = input.url;
        if (input.method) method = input.method;
      }
      var abs;
      try { abs = new URL(url, location.href); }
      catch (e) { return origFetch(input, init); }

      if (abs.origin === location.origin && abs.pathname.indexOf("/api/") === 0) {
        return handleApi(abs, method.toUpperCase(), init, input);
      }
      if (!isLocalHost(abs.host) && (abs.protocol === "https:" || abs.protocol === "http:")) {
        return jsonResponse({ ok: false, offline: true });
      }
      return origFetch(input, init);
    };
  }

  function readBody(init, input) {
    if (init && typeof init.body === "string") return Promise.resolve(init.body);
    if (input && typeof input.text === "function" && typeof input !== "string") {
      try { return input.clone().text(); } catch (e) { return Promise.resolve(""); }
    }
    return Promise.resolve("");
  }

  function handleApi(abs, method, init, input) {
    var path = abs.pathname;
    if (method === "POST" && path === "/api/arcade/score") {
      return readBody(init, input).then(function (text) {
        try {
          var body = JSON.parse(text);
          if (body && typeof body.score === "number") recordScore(body.game, body.score);
        } catch (e) {}
        return jsonResponse({ ok: false, local: true });
      });
    }
    if (path === "/api/chop/stats") return Promise.resolve(new Response(null, { status: 204 }));
    if (path === "/api/history") return origFetch("/data/btc-history.json");
    if (path === "/api/chop-block") return origFetch("/data/chop-block.json");
    if (path === "/api/heartbeat") return origFetch("/data/heartbeat.json");
    if (path === "/api/auth/x/me") return Promise.resolve(jsonResponse({ enabled: false, linked: false }));
    if (path.indexOf("/api/arcade/scores") === 0) return Promise.resolve(jsonResponse({ ok: true, scores: [], local: true }));
    return Promise.resolve(jsonResponse({ ok: false, offline: true }));
  }

  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url) {
      try {
        var abs = new URL(url, location.href);
        if (!isLocalHost(abs.host)) return true;
      } catch (e) { return true; }
      return origBeacon.apply(navigator, arguments);
    };
  }

  var ALLOW_HOSTS = {
    "galaxymind.space": 1,
    "www.galaxymind.space": 1,
    "x.com": 1,
    "twitter.com": 1,
    "mobile.twitter.com": 1,
  };

  function openExternal(href) {
    var plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GMBridge;
    if (plugin && plugin.openExternal) {
      plugin.openExternal({ url: href }).catch(function () {});
      return;
    }
    window.GM_EXTERNAL = window.GM_EXTERNAL || [];
    window.GM_EXTERNAL.push(href);
  }

  window.GM_OPEN_EXTERNAL = openExternal;

  var GAME_PREFIXES = ["/bitcoin-kart", "/chop", "/super-saylor", "/wen", "/gauntlet", "/runner", "/horizon", "/trail", "/gm", "/data"];
  function inApp(pathname) {
    if (pathname === "/" || pathname === "/index.html") return true;
    for (var i = 0; i < GAME_PREFIXES.length; i++) {
      var p = GAME_PREFIXES[i];
      if (pathname === p || pathname.indexOf(p + "/") === 0) return true;
    }
    return false;
  }

  function gameId(pathname) {
    var map = [
      ["/bitcoin-kart", "kart"],
      ["/chop", "chop"],
      ["/super-saylor", "saylor"],
      ["/wen", "wen"],
      ["/gauntlet", "gauntlet"],
      ["/runner", "runner"],
      ["/horizon", "horizon"],
      ["/trail", "trail"],
    ];
    for (var i = 0; i < map.length; i++) {
      if (pathname === map[i][0] || pathname.indexOf(map[i][0] + "/") === 0) return map[i][1];
    }
    return "";
  }

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#") return;
    var url;
    try { url = new URL(href, location.href); } catch (err) { return; }
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    if (url.protocol === "javascript:") { e.preventDefault(); return; }
    if (!isLocalHost(url.host)) {
      e.preventDefault();
      if (ALLOW_HOSTS[url.host.toLowerCase()]) openExternal(url.href);
      return;
    }
    var indexed = explicitIndex(url.pathname);
    if (indexed) {
      e.preventDefault();
      location.href = indexed + url.search + url.hash;
      return;
    }
    var bare = url.pathname;
    if (bare.length > 1 && bare.charAt(bare.length - 1) === "/") bare = bare.slice(0, -1);
    if (bare === "/arcade") {
      e.preventDefault();
      location.href = "/index.html";
      return;
    }
    if (!inApp(url.pathname) && !/\.(js|css|png|jpe?g|webp|gif|svg|json|m4a|ogg|mp3|wav|wasm|woff2?|ico|webmanifest|txt)$/i.test(url.pathname)) {
      e.preventDefault();
      openExternal("https://galaxymind.space" + url.pathname + url.search);
    }
  }, true);

  /* Directory URLs have no file extension. Stock Capacitor serves the
     menu for those. The game's own index.html is a real file. */
  function explicitIndex(pathname) {
    var bare = pathname;
    if (bare.length > 1 && bare.charAt(bare.length - 1) === "/") bare = bare.slice(0, -1);
    var roots = ["/bitcoin-kart", "/chop", "/super-saylor", "/wen", "/gauntlet", "/runner", "/horizon", "/trail"];
    for (var i = 0; i < roots.length; i++) {
      if (bare === roots[i]) return roots[i] + "/index.html";
    }
    return "";
  }

  var origOpen = window.open;
  window.open = function (url) {
    if (typeof url === "string" && /^https?:/i.test(url)) {
      try {
        var parsed = new URL(url);
        if (ALLOW_HOSTS[parsed.host.toLowerCase()]) openExternal(parsed.href);
      } catch (e) {}
      return null;
    }
    if (typeof url === "string" && url !== "") return null;
    if (origOpen) return origOpen.apply(window, arguments);
    return null;
  };

  function keepAmbient() {
    var plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GMBridge;
    if (plugin && plugin.keepAmbient) plugin.keepAmbient().catch(function () {});
  }
  window.addEventListener("pointerdown", function once() {
    keepAmbient();
    setTimeout(keepAmbient, 400);
  }, { once: true, capture: true });

  var NOTES = {
    chop: "Offline copy of a real block. Not the live chain tip.",
    wen: "Price history is saved in the app. Not a live feed.",
    gauntlet: "Price history is saved in the app. Not a live feed.",
    runner: "Price history is saved in the app. Not a live feed.",
  };

  function onChrome(e) {
    var node = e.target;
    if (!node || !node.closest) return null;
    return node.closest("#gm-back, #gm-mute, #gm-note");
  }

  /* Registered before game listeners. stopImmediatePropagation keeps a
     tap on Games or Mute from also jumping, slicing, or dropping. */
  document.addEventListener("pointerdown", function (e) {
    if (!onChrome(e)) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  var chromeAct = 0;
  function actChrome(node) {
    var now = Date.now();
    if (now - chromeAct < 400) return;
    chromeAct = now;
    if (node.id === "gm-back") location.href = "/index.html";
    else if (node.id === "gm-mute") setMuted(!muted);
    else if (node.id === "gm-note") {
      var id = document.body && document.body.getAttribute("data-gm-game");
      try { sessionStorage.setItem("gm-note-" + id, "1"); } catch (err) {}
      node.remove();
    }
  }

  function takeChrome(e) {
    var node = onChrome(e);
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    actChrome(node);
  }
  document.addEventListener("pointerup", takeChrome, true);
  document.addEventListener("click", takeChrome, true);

  function mountChrome() {
    var id = gameId(location.pathname);
    if (!id) return;
    document.body.setAttribute("data-gm-game", id);
    if (document.getElementById("gm-back")) return;

    var bar = document.createElement("div");
    bar.id = "gm-chrome";

    var btn = document.createElement("button");
    btn.id = "gm-back";
    btn.type = "button";
    btn.textContent = "\u2039 Games";
    btn.setAttribute("aria-label", "Games");
    bar.appendChild(btn);

    var mute = document.createElement("button");
    mute.id = "gm-mute";
    mute.type = "button";
    mute.textContent = muted ? "Off" : "\u266A";
    mute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    mute.setAttribute("aria-pressed", muted ? "true" : "false");
    bar.appendChild(mute);

    document.body.appendChild(bar);

    /* Games measure the window at boot, before this bar's layout exists.
       A second resize lets the canvas sit in the space under the bar. */
    requestAnimationFrame(function () {
      try { window.dispatchEvent(new Event("resize")); } catch (err) {}
    });

    if (NOTES[id] && !sessionStorage.getItem("gm-note-" + id)) {
      var note = document.createElement("button");
      note.id = "gm-note";
      note.type = "button";
      note.textContent = NOTES[id];
      document.body.appendChild(note);
    }
  }

  if (document.body) mountChrome();
  else document.addEventListener("DOMContentLoaded", mountChrome);

  /* Fullscreen cabinets already own the gesture. A document scroll under
     the finger reads as a broken control, especially on CHOP. */
  var LOCK_SCROLL = { kart: 1, chop: 1, saylor: 1 };
  document.addEventListener("touchmove", function (e) {
    var id = document.body && document.body.getAttribute("data-gm-game");
    if (LOCK_SCROLL[id]) e.preventDefault();
  }, { passive: false });
})();
