/* arcade-open-browser.js · coach people out of X / IG / FB / TikTok WebViews.
 * Twin of src/lib/in-app-browser.ts. DOM built with createElement. Dismiss remembered.
 * Patterns below must stay byte-identical to IN_APP_PATTERNS. */
(function () {
  var KEY = "gm:open-in-browser";
  try {
    if (window.localStorage.getItem(KEY) === "1") return;
  } catch (e) { /* private mode */ }
  if (
    (window.matchMedia && matchMedia("(display-mode: standalone)").matches) ||
    navigator.standalone === true
  ) {
    return;
  }

  var ua = navigator.userAgent || "";
  if (/Twitterbot|facebookexternalhit|Facebot|InstagramBot/i.test(ua)) return;

  var app = null;
  if (/TwitterAndroid|\bTwitter\b/i.test(ua)) app = "x";
  else if (/\bInstagram\b/i.test(ua)) app = "instagram";
  else if (/FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(ua)) app = "facebook";
  else if (/BytedanceWebview|TikTok|musical_ly/i.test(ua)) app = "tiktok";
  if (!app) return;

  var ios = /iPhone|iPad|iPod/i.test(ua);
  var android = /Android/i.test(ua);
  if (!ios && !android) return;

  var lead = {
    x: "X's in-app browser cannot run this game properly.",
    facebook: "Facebook's in-app browser cannot run this game properly.",
    instagram: "Instagram's in-app browser cannot run this game properly.",
    tiktok: "TikTok's in-app browser cannot run this game properly.",
  }[app];
  var step = ios
    ? {
        x: "Tap ··· then Open in Safari.",
        facebook: "Tap ··· then Open in External Browser.",
        instagram: "Tap ··· then Open in External Browser.",
        tiktok: "Tap ··· then Open in browser.",
      }[app]
    : "Tap ··· then Open in browser. Or:";

  var bar = document.createElement("aside");
  bar.setAttribute("role", "status");
  bar.style.cssText =
    "position:fixed;left:0;right:0;top:0;z-index:10000;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 12px;" +
    "background:#131316;border-bottom:1px solid rgba(247,147,26,0.4);color:#F4F4F5;" +
    "font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.35;";

  var kicker = document.createElement("p");
  kicker.textContent = "Open in a real browser";
  kicker.style.cssText =
    "margin:0;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#F7931A;";
  bar.appendChild(kicker);

  var p1 = document.createElement("p");
  p1.textContent = lead;
  p1.style.cssText = "margin:6px 0 0;";
  bar.appendChild(p1);

  var p2 = document.createElement("p");
  p2.textContent = step;
  p2.style.cssText = "margin:4px 0 0;color:#A1A1AA;";
  bar.appendChild(p2);

  var row = document.createElement("div");
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;";

  function btn(label, fill, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "min-height:44px;padding:0 16px;border-radius:999px;font-family:ui-monospace,monospace;" +
      "font-size:12px;letter-spacing:0.16em;text-transform:uppercase;cursor:pointer;" +
      (fill
        ? "border:0;background:#F7931A;color:#000;"
        : "border:1px solid #3F3F46;background:transparent;color:#A1A1AA;");
    b.addEventListener("click", onClick);
    return b;
  }

  if (android) {
    row.appendChild(
      btn("Open in Chrome", true, function () {
        var u;
        try {
          u = new URL(location.href);
        } catch (err) {
          return;
        }
        location.href =
          "intent://" +
          u.host +
          u.pathname +
          u.search +
          "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
          encodeURIComponent(u.href) +
          ";end";
      }),
    );
  }

  if (ios) {
    var copyBtn = btn("Copy link", false, function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(location.href).then(function () {
        copyBtn.textContent = "Copied";
      }).catch(function () {});
    });
    row.appendChild(copyBtn);
  }

  row.appendChild(
    btn("I'll stay here", false, function () {
      try {
        window.localStorage.setItem(KEY, "1");
      } catch (err) { /* ignore */ }
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    }),
  );

  bar.appendChild(row);

  function mount() {
    if (document.body) document.body.insertBefore(bar, document.body.firstChild);
    else document.addEventListener("DOMContentLoaded", mount);
  }
  mount();
})();
