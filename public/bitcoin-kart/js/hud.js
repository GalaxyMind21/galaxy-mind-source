// BITCOIN KART · hud.js
// Race HUD: fat position numeral, lap, bouncing item slot, sat pips,
// minimap, toasts, countdown, banners. DOM built via el() helpers and
// textContent only (house rule: no HTML-string injection in the arcade).

import { ITEMS } from "./data.js";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export function createHud(root) {
  root.textContent = "";

  // digit + superscript suffix spans; the metal gradient, outline and rank
  // medal (gold/silver/bronze/steel) live in CSS keyed by data-rank
  const pos = el("div", "hud-pos");
  pos.dataset.rank = "4";
  pos.append(el("span", "hud-pos-num", "8"), el("span", "hud-pos-suf", "th"));
  const gap = el("div", "hud-gap", "");
  const lap = el("div", "hud-lap", "LAP 1/3");
  const time = el("div", "hud-time", "0:00.0");
  const itemSlot = el("div", "hud-item");
  const itemChip = el("div", "hud-item-chip", "");
  itemSlot.appendChild(itemChip);
  // seeded so the CSS empty-gauge treatment applies before the first
  // setItem call (race.js only writes state on roulette/pickup/clear)
  itemSlot.dataset.state = "empty";
  // drift charge meter: fills while sliding, tier colors match miniTurbo FX
  const driftBar = el("div", "hud-drift");
  const driftFill = el("div", "hud-drift-fill");
  driftBar.appendChild(driftFill);
  const sats = el("div", "hud-sats");
  const satPips = [];
  for (let i = 0; i < 10; i++) {
    const p = el("span", "hud-satpip");
    sats.appendChild(p);
    satPips.push(p);
  }
  const satLabel = el("span", "hud-satlabel", "SATS");
  sats.appendChild(satLabel);
  const mini = el("canvas", "hud-minimap");
  mini.width = 180;
  mini.height = 180;
  const toasts = el("div", "hud-toasts");
  // world-space taunt bubble · race.js projects the speaking kart's
  // position each frame and drives moveBubble
  const bubble = el("div", "hud-bubble");
  const center = el("div", "hud-center");
  const flash = el("div", "hud-flash");
  const offroad = el("div", "hud-offroad");
  const wrong = el("div", "hud-wrong", "↶ WRONG WAY ↶");
  const intro = el("div", "hud-introcard");
  // cinema chrome: letterbox bars + a lower-third card + a skip hint ·
  // all pointer-events none (tap-anywhere / Enter skip rides the same
  // input funnel as the flyby, so the chip is affordance, not a button)
  const cineTop = el("div", "hud-cinebar top");
  const cineBot = el("div", "hud-cinebar bot");
  const cineCard = el("div", "hud-cinecard");
  const cineLabel = el("div", "hud-cine-label");
  const cineTitle = el("div", "hud-cine-title");
  const cineLine = el("div", "hud-cine-line");
  cineCard.append(cineLabel, cineTitle, cineLine);
  const cineSkip = el("div", "hud-cineskip", "TAP OR ENTER · SKIP ›");

  for (const n of [pos, gap, lap, time, itemSlot, driftBar, sats, mini, toasts, bubble, center, flash, offroad, wrong, intro, cineTop, cineBot, cineCard, cineSkip]) root.appendChild(n);

  const mctx = mini.getContext("2d");
  let mapPath = null;

  let toastCd = 0;

  return {
    root,
    // cinema chrome · bars + skip hint in, card per shot. data-cine on the
    // root hides the race HUD (pos/lap/map) so the reel reads clean · the
    // taunt bubble stays, it IS the boss's line
    cineOn(on) {
      root.dataset.cine = on ? "1" : "0";
      cineTop.dataset.on = cineBot.dataset.on = cineSkip.dataset.on = on ? "1" : "0";
      if (!on) cineCard.dataset.on = "0";
    },
    cineCard(label, title, line) {
      cineLabel.textContent = label || "";
      cineTitle.textContent = title || "";
      cineLine.textContent = line || "";
      cineCard.dataset.on = label || title || line ? "1" : "0";
      if (cineCard.dataset.on === "1") {
        cineCard.classList.remove("pop");
        void cineCard.offsetWidth;
        cineCard.classList.add("pop");
      }
    },
    setPos(rank) {
      // textContent concatenates the spans, so the change check survives
      // the digit + suffix split. data-rank clamps at 4: ranks past the
      // podium all wear the same steel.
      const label = ORDINAL[rank] || rank + "th";
      if (pos.textContent !== label) {
        const suf = label.replace(/^\d+/, "");
        pos.textContent = "";
        pos.append(
          el("span", "hud-pos-num", label.slice(0, label.length - suf.length)),
          el("span", "hud-pos-suf", suf),
        );
        pos.dataset.rank = String(Math.min(rank, 4));
        pos.classList.remove("pop");
        void pos.offsetWidth;
        pos.classList.add("pop");
      }
      pos.dataset.top = rank <= 3 ? "1" : "0";
    },
    setLap(cur, total, isFinal) {
      lap.textContent = "LAP " + Math.min(Math.max(cur, 1), total) + "/" + total;
      lap.dataset.final = isFinal ? "1" : "0";
    },
    // live competitive gap next to the position numeral · null hides it
    setGap(str) {
      if (!str) { gap.dataset.on = "0"; return; }
      gap.dataset.on = "1";
      if (gap.textContent !== str) gap.textContent = str;
    },
    setTime(ms) {
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const d = Math.floor((ms % 1000) / 100);
      time.textContent = m + ":" + String(s).padStart(2, "0") + "." + d;
    },
    setItem(id, rouletteTick) {
      if (rouletteTick !== undefined) {
        const keys = Object.keys(ITEMS);
        const it = ITEMS[keys[rouletteTick % keys.length]];
        itemChip.textContent = it.chip;
        itemChip.style.color = it.color;
        itemSlot.dataset.state = "rolling";
      } else if (id) {
        const it = ITEMS[id];
        itemChip.textContent = it.chip;
        itemChip.style.color = it.color;
        itemSlot.dataset.state = "held";
        itemSlot.title = it.name + " · " + it.desc;
      } else {
        itemChip.textContent = "";
        itemSlot.dataset.state = "empty";
        itemSlot.title = "";
      }
    },
    setSats(n, speedPct) {
      for (let i = 0; i < 10; i++) satPips[i].dataset.on = i < n ? "1" : "0";
      // sats ARE top speed (physics: +0.35/sat) · say so where the pips
      // live, so the incentive is legible instead of lore
      if (speedPct !== undefined) {
        satLabel.textContent = speedPct > 0 ? "SATS · +" + speedPct + "% SPEED" : "SATS · = TOP SPEED";
      }
    },
    setDrift(active, charge, tier) {
      driftBar.dataset.on = active ? "1" : "0";
      if (!active) return;
      driftFill.style.width = Math.min(100, (charge / 2.1) * 100) + "%";
      driftBar.dataset.tier = tier;
    },
    setBubble(text) {
      bubble.textContent = text;
      bubble.dataset.on = "1";
    },
    moveBubble(x, y, visible) {
      if (!visible) { bubble.dataset.visible = "0"; return; }
      bubble.dataset.visible = "1";
      bubble.style.transform = "translate(-50%, -100%) translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
    },
    clearBubble() {
      bubble.dataset.on = "0";
      bubble.dataset.visible = "0";
    },
    toast(text, color, taunt) {
      if (taunt && toastCd > 0) return;
      if (taunt) toastCd = 3.5;
      const t = el("div", "hud-toast" + (taunt ? " taunt" : ""), text);
      if (color) t.style.borderColor = color;
      toasts.appendChild(t);
      setTimeout(() => t.remove(), 2600);
      while (toasts.children.length > 3) toasts.firstChild.remove();
    },
    tick(dt) {
      if (toastCd > 0) toastCd -= dt;
    },
    countdown(text) {
      center.textContent = text || "";
      center.dataset.go = text === "GO" ? "1" : "0";
      if (text) {
        center.classList.remove("pop");
        void center.offsetWidth;
        center.classList.add("pop");
      }
    },
    banner(text) {
      center.textContent = text;
      center.dataset.go = "1";
      center.classList.remove("pop");
      void center.offsetWidth;
      center.classList.add("pop");
      setTimeout(() => { if (center.textContent === text) center.textContent = ""; }, 2200);
    },
    flashScreen(color) {
      flash.style.background = color || "rgba(255,209,102,0.5)";
      flash.dataset.on = "1";
      setTimeout(() => { flash.dataset.on = "0"; }, 180);
    },
    wrongWay(on) {
      wrong.dataset.on = on ? "1" : "0";
    },
    offRoad(on) {
      offroad.dataset.on = on ? "1" : "0";
    },
    introCard(title, sub, line, tip) {
      intro.textContent = "";
      intro.append(
        el("div", "hud-intro-world", sub),
        el("div", "hud-intro-name", title),
        el("div", "hud-intro-line", line),
      );
      if (tip) intro.append(el("div", "hud-intro-tip", "TIP · " + tip));
      intro.dataset.on = "1";
    },
    clearIntro() {
      intro.dataset.on = "0";
    },
    initMap(path) {
      mapPath = path;
      mctx.clearRect(0, 0, 180, 180);
    },
    drawMap(karts, player) {
      if (!mapPath) return;
      mctx.clearRect(0, 0, 180, 180);
      mctx.strokeStyle = "rgba(245,245,247,0.6)";
      mctx.lineWidth = 4;
      mctx.lineJoin = "round";
      // x is mirrored so the map's chirality matches the driver's view
      // (screen-right while driving is world -X · see readInput note).
      mctx.beginPath();
      for (let i = 0; i < mapPath.norm.length; i++) {
        const p = mapPath.norm[i];
        const x = 14 + (1 - p[0]) * 152, y = 14 + p[1] * 152;
        if (i === 0) mctx.moveTo(x, y);
        else mctx.lineTo(x, y);
      }
      mctx.closePath();
      mctx.stroke();
      // start/finish anchor tick
      if (mapPath.start) {
        const sx = 14 + (1 - mapPath.start[0]) * 152, sy = 14 + mapPath.start[1] * 152;
        mctx.fillStyle = "#F5F5F7";
        mctx.fillRect(sx - 4, sy - 4, 4, 4);
        mctx.fillStyle = "#0A0A0B";
        mctx.fillRect(sx, sy - 4, 4, 4);
        mctx.fillStyle = "#F5F5F7";
        mctx.fillRect(sx, sy, 4, 4);
        mctx.fillStyle = "#0A0A0B";
        mctx.fillRect(sx - 4, sy, 4, 4);
      }
      for (const k of karts) {
        const x = 14 + (1 - ((k.pos[0] - mapPath.minX) * mapPath.scale + mapPath.offX)) * 152;
        const y = 14 + ((k.pos[2] - mapPath.minZ) * mapPath.scale + mapPath.offZ) * 152;
        if (k === player) {
          // heading triangle, not a dot · you can read your line at a
          // glance. Screen x mirrors world x, so the world heading
          // vector (sin h, cos h) lands at atan2(cos h, -sin h).
          mctx.save();
          mctx.translate(x, y);
          mctx.rotate(Math.atan2(Math.cos(k.heading), -Math.sin(k.heading)));
          mctx.beginPath();
          mctx.moveTo(8, 0);
          mctx.lineTo(-5, 5);
          mctx.lineTo(-5, -5);
          mctx.closePath();
          mctx.fillStyle = "#F7931A";
          mctx.fill();
          mctx.strokeStyle = "#0A0A0B";
          mctx.lineWidth = 2;
          mctx.stroke();
          mctx.restore();
        } else {
          mctx.beginPath();
          mctx.arc(x, y, 4, 0, Math.PI * 2);
          mctx.fillStyle = k.driver.side === "fiat" ? "#7FBF8E" : "#7DE3FF";
          mctx.fill();
        }
      }
    },
    dispose() { root.textContent = ""; },
  };
}
