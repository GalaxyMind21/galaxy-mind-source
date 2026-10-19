/*!
 * Galaxy Mind — Bitcoin Buying Gauge embed widget v2 (May 2026)
 * https://galaxymind.space/embed
 *
 * Drop a `<div data-galaxymind-gauge></div>` anywhere on your page and
 * include this script. The widget renders a live-updating gauge styled
 * to match the on-site instrument: beveled bezel with brushed-steel
 * radial gradient, discrete color zones (red/amber/green), engraved
 * BTC BUY PRESSURE nameplate, glowing needle. Refreshes every 60s and
 * links back to galaxymind.space/stack on click.
 *
 * Options (data-attributes on the same div · all optional, backward
 * compatible · omit them for the original dark, gauge-only card):
 *   data-theme="light"      → recolor the card for light backgrounds
 *                             (the dial stays dark by design)
 *   data-show-score="true"  → show the numeric 0-100 score + tier under
 *                             the gauge
 *   data-show-sources="true"→ show a small "data sources · updated HH:MM
 *                             UTC" credit line under the footer, so the
 *                             widget reads as a sourced instrument rather
 *                             than an opaque number on someone else's site
 * Example:
 *   <div data-galaxymind-gauge data-theme="light" data-show-score="true"></div>
 *
 * SUPPLY CLOCK variant (July 2026): drop `<div data-galaxymind-clock></div>`
 * instead (same script, both widgets can coexist on one page). Renders
 * the live Bitcoin Float · the BTC still purchasable · as a machined
 * odometer ticking DOWN in real time between daily snapshots, exactly
 * like the hero on galaxymind.space/float. The card is always dark by
 * design (physical instrument on any wall); honest states: LIVE ·
 * DRAINING, REFILLING (float grew · the clock holds still rather than
 * faking a drain), BASELINE (one snapshot so far), SYNCING (degraded).
 * Data: polls /api/float-heartbeat (~200 bytes) every 5 minutes; the
 * tick between polls is client-side extrapolation at yesterday's net
 * drain rate, anchored to the snapshot timestamp and capped at 48h ·
 * the same honesty rules as the on-site clock.
 *
 * Self-contained vanilla JS, no dependencies, ~9 KB. DOM built via
 * createElement (no innerHTML) so it's safe to embed anywhere — every
 * value flowing into the DOM is type-checked or comes from a hardcoded
 * lookup. Supports a `degraded` flag from /api/heartbeat (when ≥4/8
 * market signals are null) → shows "updating" label + neutral gauge.
 * MIT-licensed; rip it apart however you like.
 *
 * NOTE: if you bump the visual or add features, regenerate the SRI
 * hash via `node scripts/embed-sri.mjs` so /embed surfaces the
 * correct integrity value for embedders pinning a known version.
 */
(function () {
  "use strict";

  var ENDPOINT = "https://galaxymind.space/api/heartbeat";
  var POLL_MS = 60000; // 60 s · gentler than the on-page poll cadence
  var CLOCK_ENDPOINT = "https://galaxymind.space/api/float-heartbeat";
  var CLOCK_POLL_MS = 300000; // 5 min · float data only changes daily
  var CLOCK_CAP_S = 48 * 3600; // extrapolation ceiling · mirrors SupplyClock
  var SVG_NS = "http://www.w3.org/2000/svg";

  // Tier display vocabulary — mirrors lib/stack TIER_LABEL.
  var TIER_LABEL = {
    COLD: "HOLD",
    CHILL: "STACK SMALL",
    WARM: "STACK",
    HOT: "STACK NOW",
    MOLTEN: "STACK HUGE",
  };

  // Color tokens — synced with /stack's PressureGauge palette.
  var ACCENT = "#F7931A";
  var ICE = "#7ec0ff";
  var COOL_BLUE = "#5478b8";
  var RED_ZONE = "#ff3a4f";
  var AMBER_ZONE = "#ffb547";
  var GREEN_ZONE = "#34e394";
  var BG_BASE = "#12110F";
  var BORDER_SUBTLE = "#26262C";
  var TEXT_PRIM = "#F2EFE9";
  var TEXT_TERT = "#5C5C66";

  // Gauge geometry. Compact-but-readable scale for an embed widget.
  // Center coords + radii match the proportions of the live gauge,
  // just shrunk to fit a 280-wide card.
  var VW = 200;
  var VH = 175;
  var CX = 100;
  var CY = 105;
  var R_BEZEL_OUTER = 90;
  var R_BEZEL_INNER = 76;
  var R_DIAL = 70;
  var R_TICK_OUTER = 73;
  var R_TICK_INNER = 67;
  var R_NEEDLE_TIP = 60;
  var R_HUB = 6;

  function targets() {
    return document.querySelectorAll("[data-galaxymind-gauge]");
  }

  // ---- DOM helpers (no innerHTML, safe by construction) -------------

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (kids) for (var i = 0; i < kids.length; i++) node.appendChild(kids[i]);
    return node;
  }
  function svg(tag, attrs, kids) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (kids) for (var i = 0; i < kids.length; i++) node.appendChild(kids[i]);
    return node;
  }
  function txt(s) {
    return document.createTextNode(String(s));
  }
  function style(node, css) {
    for (var k in css) node.style[k] = css[k];
    return node;
  }
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  // "2026-06-14T02:13:00Z" → "02:13" (UTC). "" on parse failure · avoids
  // padStart for ancient-browser safety (this widget embeds anywhere).
  function fmtUtcHM(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
  }

  // ---- Geometry helpers --------------------------------------------

  function polar(r, deg) {
    var rad = (deg * Math.PI) / 180;
    return {
      x: +(CX + Math.cos(rad) * r).toFixed(3),
      y: +(CY + Math.sin(rad) * r).toFixed(3),
    };
  }
  function arcPath(r, startDeg, endDeg) {
    var a = polar(r, startDeg);
    var b = polar(r, endDeg);
    var sweep = endDeg - startDeg;
    var largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    var sweepFlag = sweep > 0 ? 1 : 0;
    return (
      "M " + a.x + " " + a.y +
      " A " + r + " " + r +
      " 0 " + largeArc + " " + sweepFlag + " " + b.x + " " + b.y
    );
  }
  function scoreToGaugeDeg(s) {
    return -180 + (Math.max(0, Math.min(100, s)) / 100) * 180;
  }
  function scoreToNeedleDeg(s) {
    return scoreToGaugeDeg(s) + 90; // needle's 0° points up
  }

  // ---- Build the embedded gauge SVG --------------------------------

  function gaugeSvg(score, tier) {
    var hasScore = typeof score === "number";
    var s = hasScore ? Math.max(0, Math.min(100, score)) : 50;
    var isFrozen = hasScore && s < 40;
    var inBuyZone = hasScore && s >= 65;

    // Tier-color for the needle + score readout.
    var primary = isFrozen ? ICE : ACCENT;

    // ---- Defs: gradients + filter ----
    var defs = svg("defs", null, [
      // Bezel: radial gradient anchored at the top (read as overhead lighting).
      (function () {
        var g = svg("radialGradient", {
          id: "gm-bezel",
          cx: "50%", cy: "0%", r: "100%",
        });
        var stops = [
          ["0%", "#c8ccd5"],
          ["20%", "#8a909d"],
          ["55%", "#3e424b"],
          ["100%", "#15171c"],
        ];
        for (var i = 0; i < stops.length; i++) {
          g.appendChild(svg("stop", { offset: stops[i][0], "stop-color": stops[i][1] }));
        }
        return g;
      })(),
      // Lava-fill gradient for the active arc.
      (function () {
        var g = svg("linearGradient", {
          id: "gm-lava",
          x1: String(CX - 60), y1: "0",
          x2: String(CX + 60), y2: "0",
          gradientUnits: "userSpaceOnUse",
        });
        var stops = [
          ["0%", ICE, "0.85"],
          ["14%", COOL_BLUE, "0.95"],
          ["50%", "#dadada", "0.5"],
          ["78%", "#FFA64D", "0.95"],
          ["100%", "#FF5A08", "1"],
        ];
        for (var j = 0; j < stops.length; j++) {
          g.appendChild(svg("stop", {
            offset: stops[j][0],
            "stop-color": stops[j][1],
            "stop-opacity": stops[j][2],
          }));
        }
        return g;
      })(),
      // Needle metallic gradient.
      (function () {
        var g = svg("linearGradient", {
          id: "gm-needle",
          x1: "0", y1: String(CY - R_NEEDLE_TIP),
          x2: "0", y2: String(CY),
          gradientUnits: "userSpaceOnUse",
        });
        g.appendChild(svg("stop", { offset: "0%", "stop-color": "#fff7e0" }));
        g.appendChild(svg("stop", { offset: "40%", "stop-color": ACCENT }));
        g.appendChild(svg("stop", { offset: "100%", "stop-color": "#7a4408" }));
        return g;
      })(),
      // Soft glow filter for the needle + active arc.
      (function () {
        var f = svg("filter", { id: "gm-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
        f.appendChild(svg("feGaussianBlur", { stdDeviation: "2" }));
        var m = svg("feMerge");
        m.appendChild(svg("feMergeNode"));
        m.appendChild(svg("feMergeNode", { in: "SourceGraphic" }));
        f.appendChild(m);
        return f;
      })(),
    ]);

    // ---- BEZEL ----
    // Outer disc (bezel metal)
    var bezelOuter = svg("circle", {
      cx: String(CX), cy: String(CY), r: String(R_BEZEL_OUTER),
      fill: "url(#gm-bezel)",
    });
    // Cut-out inner area to expose dial bg
    var bezelInner = svg("circle", {
      cx: String(CX), cy: String(CY), r: String(R_BEZEL_INNER),
      fill: BG_BASE,
    });
    // Outer chamfer highlight
    var chamfer = svg("circle", {
      cx: String(CX), cy: String(CY), r: String(R_BEZEL_OUTER - 1),
      fill: "none",
      stroke: "rgba(255,255,255,0.20)", "stroke-width": "1",
    });

    // ---- DIAL FACE ----
    // Color zones (subtle)
    var zonesG = svg("g", null, [
      svg("path", {
        d: arcPath(R_DIAL - 8, scoreToGaugeDeg(0), scoreToGaugeDeg(35)),
        stroke: RED_ZONE, "stroke-width": "1.6", fill: "none",
        "stroke-linecap": "round", opacity: "0.45",
      }),
      svg("path", {
        d: arcPath(R_DIAL - 8, scoreToGaugeDeg(35), scoreToGaugeDeg(65)),
        stroke: AMBER_ZONE, "stroke-width": "1.6", fill: "none",
        "stroke-linecap": "round", opacity: "0.45",
      }),
      svg("path", {
        d: arcPath(R_DIAL - 8, scoreToGaugeDeg(65), scoreToGaugeDeg(100)),
        stroke: GREEN_ZONE, "stroke-width": "1.6", fill: "none",
        "stroke-linecap": "round", opacity: "0.5",
      }),
    ]);

    // Tick marks at 0 / 25 / 50 / 75 / 100 (just majors — we're tiny)
    var ticksG = svg("g");
    var ticksAt = [0, 25, 50, 75, 100];
    for (var t = 0; t < ticksAt.length; t++) {
      var deg = scoreToGaugeDeg(ticksAt[t]);
      var inner = polar(R_TICK_INNER, deg);
      var outer = polar(R_TICK_OUTER, deg);
      ticksG.appendChild(svg("line", {
        x1: String(inner.x), y1: String(inner.y),
        x2: String(outer.x), y2: String(outer.y),
        stroke: "rgba(200,205,215,0.55)", "stroke-width": "1",
      }));
    }

    // Background dial track
    var trackPath = svg("path", {
      d: arcPath(R_DIAL, -180, 0),
      stroke: "rgba(255,255,255,0.07)", "stroke-width": "2",
      fill: "none", "stroke-linecap": "round",
    });

    // Active lava-fill arc (only when we have a score)
    var fillEndAngle = scoreToGaugeDeg(s);
    var fillG = svg("g");
    if (hasScore && s > 0) {
      fillG.appendChild(svg("path", {
        d: arcPath(R_DIAL, -180, fillEndAngle),
        stroke: "url(#gm-lava)", "stroke-width": "4",
        fill: "none", "stroke-linecap": "round",
        filter: "url(#gm-glow)",
      }));
    }

    // Cardinal labels: HOLD / NEUTRAL / HUGE — three is enough at this scale
    var cardinalsG = svg("g");
    var cardinals = [
      { label: "HOLD", deg: -180 },
      { label: "★", deg: -90 },
      { label: "HUGE", deg: 0 },
    ];
    for (var c = 0; c < cardinals.length; c++) {
      var cp = polar(R_DIAL + 9, cardinals[c].deg);
      cardinalsG.appendChild(svg("text", {
        x: String(cp.x), y: String(cp.y),
        "text-anchor": "middle", "dominant-baseline": "middle",
        fill: TEXT_TERT,
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "font-size": "7",
        "letter-spacing": "0.18em",
      }, [txt(cardinals[c].label)]));
    }

    // Needle (rotated by transform)
    var needleAngle = hasScore ? scoreToNeedleDeg(s) : 0;
    var needleColor = isFrozen ? ICE : ACCENT;
    var needleG = svg("g", {
      transform: "rotate(" + needleAngle.toFixed(2) + " " + CX + " " + CY + ")",
    });
    if (hasScore) {
      // Soft outer glow halo
      needleG.appendChild(svg("polygon", {
        points: [
          (CX - 4) + "," + (CY + 2),
          (CX + 4) + "," + (CY + 2),
          (CX + 1.5) + "," + (CY - R_NEEDLE_TIP + 8),
          (CX - 1.5) + "," + (CY - R_NEEDLE_TIP + 8),
        ].join(" "),
        fill: needleColor, opacity: "0.25",
      }));
      // Counter-balance tail
      needleG.appendChild(svg("polygon", {
        points: [
          (CX - 2) + "," + CY,
          (CX + 2) + "," + CY,
          (CX + 1) + "," + (CY + 12),
          (CX - 1) + "," + (CY + 12),
        ].join(" "),
        fill: "rgba(40,42,48,0.95)",
      }));
      // Main needle body — tapered metallic
      needleG.appendChild(svg("polygon", {
        points: [
          (CX - 3.5) + "," + (CY + 1),
          (CX + 3.5) + "," + (CY + 1),
          (CX + 1) + "," + (CY - R_NEEDLE_TIP + 5),
          (CX - 1) + "," + (CY - R_NEEDLE_TIP + 5),
        ].join(" "),
        fill: isFrozen ? ICE : "url(#gm-needle)",
        filter: "url(#gm-glow)",
      }));
      // Arrowhead at tip
      needleG.appendChild(svg("polygon", {
        points: [
          (CX - 3) + "," + (CY - R_NEEDLE_TIP + 5),
          (CX + 3) + "," + (CY - R_NEEDLE_TIP + 5),
          CX + "," + (CY - R_NEEDLE_TIP - 3),
        ].join(" "),
        fill: needleColor,
      }));
    }

    // Hub
    var hubG = svg("g", null, [
      svg("circle", {
        cx: String(CX), cy: String(CY), r: String(R_HUB),
        fill: needleColor, filter: "url(#gm-glow)",
      }),
      svg("circle", { cx: String(CX), cy: String(CY), r: "2.5", fill: BG_BASE }),
      svg("circle", { cx: String(CX), cy: String(CY), r: "1", fill: needleColor }),
    ]);

    // Score readout — engraved inside the dial below the hub.
    var scoreReadout = svg("g");
    if (hasScore) {
      scoreReadout.appendChild(svg("text", {
        x: String(CX), y: String(CY + 32),
        "text-anchor": "middle", "dominant-baseline": "middle",
        fill: primary,
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "font-size": "20", "font-weight": "600",
        "letter-spacing": "-0.02em",
        filter: "url(#gm-glow)",
      }, [txt(String(Math.round(s)))]));
      scoreReadout.appendChild(svg("text", {
        x: String(CX), y: String(CY + 50),
        "text-anchor": "middle", "dominant-baseline": "middle",
        fill: TEXT_TERT,
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "font-size": "7",
        "letter-spacing": "0.28em",
      }, [txt(((tier && TIER_LABEL[tier]) || "·").toUpperCase())]));
    }

    // Compose the whole SVG
    return svg("svg", {
      width: String(VW), height: String(VH),
      viewBox: "0 0 " + VW + " " + VH,
      "aria-hidden": "true",
    }, [
      defs,
      bezelOuter,
      bezelInner,
      chamfer,
      zonesG,
      ticksG,
      cardinalsG,
      trackPath,
      fillG,
      scoreReadout,
      needleG,
      hubG,
    ]);
  }

  // ---- Render a single target node ---------------------------------

  function render(target, data) {
    var degraded = !!(data && data.degraded);
    var hasData = !degraded && data && typeof data.score === "number";
    var score = hasData ? data.score : null;
    var tier = hasData ? String(data.tier || "") : null;
    var isFrozen = hasData && score < 40;
    var inBuyZone = hasData && score >= 65;

    // ---- Variant options (data-attributes on the target div) --------
    // Backward compatible: with no attributes you get the original
    // dark, no-readout card. data-theme="light" recolors the CARD only
    // (the brass-bezel dial stays dark on purpose · a physical
    // instrument reads well on a light wall). data-show-score="true"
    // adds a numeric score readout under the gauge.
    var lightTheme = target.getAttribute("data-theme") === "light";
    var showScore = target.getAttribute("data-show-score") === "true";
    var showSources = target.getAttribute("data-show-sources") === "true";
    var cardBg = lightTheme ? "#ffffff" : BG_BASE;
    var cardText = lightTheme ? "#1a1a1f" : TEXT_PRIM;
    var cardTert = lightTheme ? "#6b6b76" : TEXT_TERT;
    var cardBorder = lightTheme ? "#e3e3e8" : BORDER_SUBTLE;
    var primary = isFrozen ? ICE : ACCENT;

    // Brand label (top of card)
    var brand = style(el("div"), {
      fontSize: "9px",
      letterSpacing: "0.28em",
      textTransform: "uppercase",
      color: cardTert,
      textAlign: "center",
    });
    brand.appendChild(txt(degraded ? "BTC BUY PRESSURE · updating" : "BTC BUY PRESSURE · live"));

    // The gauge wrapper — centers the SVG
    var gaugeWrap = style(el("div"), {
      display: "flex",
      justifyContent: "center",
      marginTop: "8px",
    });
    gaugeWrap.appendChild(gaugeSvg(score, tier));

    // Optional numeric readout (data-show-score="true")
    var scoreReadout = null;
    if (showScore) {
      scoreReadout = style(el("div"), {
        textAlign: "center",
        marginTop: "6px",
      });
      var scoreNum = style(el("span"), {
        fontSize: "20px",
        fontWeight: "700",
        color: primary,
      });
      scoreNum.appendChild(txt(hasData ? String(score) : "··"));
      var scoreTier = style(el("span"), {
        fontSize: "10px",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: cardTert,
        marginLeft: "8px",
      });
      scoreTier.appendChild(
        txt(hasData ? tier || "" : degraded ? "updating" : ""),
      );
      scoreReadout.appendChild(scoreNum);
      scoreReadout.appendChild(scoreTier);
    }

    // Footer link-out — bordered chip pointing at /stack
    var footer = style(el("div"), {
      fontSize: "9px",
      color: cardTert,
      marginTop: "8px",
      textAlign: "center",
      letterSpacing: "0.22em",
      textTransform: "uppercase",
    });
    var footerInner = style(el("span"), {
      borderTop: "1px solid " + cardBorder,
      paddingTop: "8px",
      display: "inline-block",
    });
    footerInner.appendChild(txt("galaxymind.space ↗"));
    footer.appendChild(footerInner);

    // Optional data-source + freshness credit (data-show-sources="true").
    // Names the live signal providers the gauge blends, plus the snapshot
    // time from /api/heartbeat's asOf · turns the embed into a sourced
    // instrument instead of an opaque number on a third-party page.
    if (showSources) {
      var hm = fmtUtcHM(data && data.asOf);
      var srcLine = style(el("div"), {
        fontSize: "8px",
        color: cardTert,
        marginTop: "6px",
        letterSpacing: "0.1em",
        textTransform: "none",
        lineHeight: "1.5",
      });
      var srcText = degraded
        ? "Data: Coinmetrics · Yahoo · OKX · alt.me · updating"
        : "Data: Coinmetrics · Yahoo · OKX · alt.me" +
          (hm ? " · " + hm + " UTC" : "");
      srcLine.appendChild(txt(srcText));
      footer.appendChild(srcLine);
    }

    // The card itself — uses an outer glow that subtly tracks the tier
    // color (orange in buy zone, blue in frozen, none otherwise)
    var glow = inBuyZone
      ? "0 0 24px rgba(247,147,26,0.18)"
      : isFrozen
        ? "0 0 24px rgba(126,192,255,0.18)"
        : "none";
    var card = style(el("div"), {
      background: cardBg,
      border: "1px solid " + cardBorder,
      borderRadius: "12px",
      padding: "14px 16px 12px",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      maxWidth: "260px",
      boxShadow: glow,
      transition: "box-shadow 0.6s",
    });
    card.appendChild(brand);
    card.appendChild(gaugeWrap);
    if (scoreReadout) card.appendChild(scoreReadout);
    card.appendChild(footer);

    // Wrap in anchor → /stack
    var link = el("a", {
      href: "https://galaxymind.space/stack?utm_source=embed",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    style(link, {
      display: "block",
      textDecoration: "none",
      color: cardText,
    });
    link.appendChild(card);

    // Clear and append
    while (target.firstChild) target.removeChild(target.firstChild);
    target.appendChild(link);
  }

  // ---- Supply Clock widget (data-galaxymind-clock) ------------------
  //
  // Fixed-dark machined card · the on-site instrument rule (dark dials
  // keep fixed light text regardless of host page theme). Digits tick
  // once per second via ONE shared interval across all clock targets.

  function clockTargets() {
    return document.querySelectorAll("[data-galaxymind-clock]");
  }

  // Live per-target state: [{ digitsEl, stateEl, data }]. Rebuilt on
  // every fetch; the 1s ticker only touches textContent.
  var clockStates = [];

  function clockDrainPerSecond(data) {
    if (!data || data.degraded) return 0;
    if (typeof data.prevInPlay !== "number") return 0;
    if (typeof data.inPlay !== "number") return 0;
    var dailyDelta = data.inPlay - data.prevInPlay;
    if (!isFinite(dailyDelta) || dailyDelta >= 0) return 0;
    return -dailyDelta / 86400;
  }

  function clockDisplayValue(data) {
    if (!data || typeof data.inPlay !== "number") return null;
    var drain = clockDrainPerSecond(data);
    if (drain === 0) return data.inPlay;
    var asOfMs = data.asOf ? new Date(data.asOf).getTime() : NaN;
    if (isNaN(asOfMs)) return data.inPlay;
    var elapsedS = (Date.now() - asOfMs) / 1000;
    if (elapsedS < 0) elapsedS = 0;
    if (elapsedS > CLOCK_CAP_S) elapsedS = CLOCK_CAP_S;
    return data.inPlay - drain * elapsedS;
  }

  function clockStateLabel(data) {
    if (!data || data.degraded || typeof data.inPlay !== "number") {
      return { label: "SYNCING", color: "#8C8C96" };
    }
    if (typeof data.prevInPlay !== "number") {
      return { label: "BASELINE", color: "#8C8C96" };
    }
    if (data.inPlay < data.prevInPlay) {
      return { label: "LIVE · DRAINING", color: ACCENT };
    }
    return { label: "REFILLING", color: "#4ADE80" };
  }

  function fmtBtc(v) {
    if (v == null || !isFinite(v)) return "··,···,···";
    return v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function renderClock(target, data) {
    var st = clockStateLabel(data);

    var header = style(el("div"), {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
    });
    var brand = style(el("span"), {
      fontSize: "9px",
      letterSpacing: "0.26em",
      textTransform: "uppercase",
      color: "rgba(235,225,210,0.55)",
    });
    brand.appendChild(txt("BITCOIN STILL IN PLAY"));
    var stateEl = style(el("span"), {
      fontSize: "8px",
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      color: st.color,
    });
    stateEl.appendChild(txt(st.label));
    header.appendChild(brand);
    header.appendChild(stateEl);

    var digitsEl = style(el("div"), {
      fontSize: "27px",
      fontWeight: "700",
      letterSpacing: "0.04em",
      color: "#FFD9A0",
      textShadow: "0 0 14px rgba(247,147,26,0.45)",
      textAlign: "center",
      marginTop: "10px",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
    });
    digitsEl.appendChild(txt(fmtBtc(clockDisplayValue(data))));
    var unit = style(el("div"), {
      fontSize: "9px",
      letterSpacing: "0.3em",
      textTransform: "uppercase",
      color: "rgba(235,225,210,0.66)",
      textAlign: "center",
      marginTop: "4px",
    });
    unit.appendChild(txt("BTC · OF 21,000,000 EVER"));

    var footer = style(el("div"), {
      fontSize: "9px",
      color: "rgba(235,225,210,0.55)",
      marginTop: "10px",
      textAlign: "center",
      letterSpacing: "0.22em",
      textTransform: "uppercase",
    });
    var footerInner = style(el("span"), {
      borderTop: "1px solid rgba(235,225,210,0.14)",
      paddingTop: "8px",
      display: "inline-block",
    });
    footerInner.appendChild(txt("galaxymind.space/float ↗"));
    footer.appendChild(footerInner);

    // Machined fixed-dark card · subtle top edge catch-light like the
    // on-site bezels.
    var card = style(el("div"), {
      background: "linear-gradient(180deg, #16100a 0%, #0a0605 55%)",
      border: "1px solid #2E2E36",
      borderTopColor: "#55503F",
      borderRadius: "12px",
      padding: "14px 18px 12px",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      width: "100%",
      minWidth: "280px",
      maxWidth: "320px",
      boxSizing: "border-box",
      boxShadow:
        st.label === "LIVE · DRAINING"
          ? "0 0 24px rgba(247,147,26,0.16)"
          : "none",
      transition: "box-shadow 0.6s",
    });
    card.appendChild(header);
    card.appendChild(digitsEl);
    card.appendChild(unit);
    card.appendChild(footer);

    var link = el("a", {
      href: "https://galaxymind.space/float?utm_source=embed",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    style(link, { display: "block", textDecoration: "none" });
    link.appendChild(card);

    while (target.firstChild) target.removeChild(target.firstChild);
    target.appendChild(link);

    return { digitsEl: digitsEl, data: data };
  }

  function fetchAndRenderClocks() {
    var els = clockTargets();
    if (!els.length) return;
    fetch(CLOCK_ENDPOINT, { mode: "cors" })
      .then(function (r) {
        if (!r.ok) return { degraded: true };
        return r.json().then(function (j) {
          return j && j.ok === false ? { degraded: true } : j;
        });
      })
      .then(function (data) {
        clockStates = [];
        for (var i = 0; i < els.length; i++) {
          clockStates.push(renderClock(els[i], data));
        }
      })
      .catch(function () {
        clockStates = [];
        for (var i = 0; i < els.length; i++) {
          clockStates.push(renderClock(els[i], { degraded: true }));
        }
      });
  }

  function tickClocks() {
    for (var i = 0; i < clockStates.length; i++) {
      var cs = clockStates[i];
      if (!cs || !cs.digitsEl) continue;
      cs.digitsEl.textContent = fmtBtc(clockDisplayValue(cs.data));
    }
  }

  // ---- Polling loop -------------------------------------------------

  function fetchAndRender() {
    var els = targets();
    if (!els.length) return;
    fetch(ENDPOINT, { mode: "cors" })
      .then(function (r) {
        if (!r.ok) return { degraded: true };
        return r.json().then(function (j) {
          // Server success shape or error JSON both land here; if the
          // body signals failure, coerce to degraded for the widget.
          return j && j.ok === false ? { degraded: true } : j;
        });
      })
      .then(function (data) {
        for (var i = 0; i < els.length; i++) render(els[i], data);
      })
      .catch(function () {
        for (var i = 0; i < els.length; i++) render(els[i], { degraded: true });
      });
  }

  function init() {
    var els = targets();
    for (var i = 0; i < els.length; i++) render(els[i], { degraded: true });
    if (els.length) {
      fetchAndRender();
      setInterval(fetchAndRender, POLL_MS);
    }
    var clocks = clockTargets();
    if (clocks.length) {
      for (var c = 0; c < clocks.length; c++) {
        renderClock(clocks[c], { degraded: true });
      }
      fetchAndRenderClocks();
      setInterval(fetchAndRenderClocks, CLOCK_POLL_MS);
      setInterval(tickClocks, 1000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
