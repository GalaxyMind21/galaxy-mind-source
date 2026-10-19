// BITCOIN KART · main.js
// Boot, quality tiers, input (keyboard / touch / gamepad), the screen state
// machine, cup sequencing, adventure rewards, the Satoshi unlock flow, and
// share intents. All DOM is built with el() and textContent (house rule:
// no HTML-string injection anywhere in the arcade).

import { createRenderer } from "./gl.js";
import {
  ROSTER, TRACKS, CUPS, CUP_POINTS, WORLDS, GATES, COPY, CODEX, CHALLENGES, TAGLINE,
  SHARE_URL, DEFAULT_DRIVER, GOLD_SATOSHI, trackById, balloonsForResult,
  CLASSES, MIRROR_DESC, kartDayNumber, dailyCombo, KART_BASE_MS, driverById,
} from "./data.js";
import { postDailyScore, dailyScore, KART_FLOOR_MS, fetchDailyBoard, fetchDailyBoardCached, fetchLinkState, fetchLinkedHandle, fetchLeaderGhost, uploadLeaderGhost, mintDareGhost, fetchDareGhost, retryUnsent, getHandle, formatKartTime, cloudSyncKart } from "./board.js";
import { SAVE, store, saveGhost, loadGhost, saveDailyGhost, loadDailyGhost, quantizeGhost, recordArcadeRun } from "./save.js";
import { Snd } from "./audio.js";
import { createRace, kartGL, clearKartGL } from "./race.js";
import { createShowroom, statBars } from "./select.js";
import { createAtoll } from "./hub.js";
import { clearKartMesh } from "./geometry.js";
import { el } from "./hud.js";
import { createCoach } from "./coach.js";
import { clamp } from "./math3d.js";
import { paintFace, FACE_CROP } from "./faces.js";

const canvas = document.getElementById("gl");
const uiRoot = document.getElementById("ui");
const hudRoot = document.getElementById("hud");
const touchRoot = document.getElementById("touch");
const compatPanel = document.getElementById("compat");

const R = createRenderer(canvas);
SAVE.load();
goldify(); // returning 100%-complete players see Golden Satoshi from boot
if (SAVE.settings.reduceFx === null || SAVE.settings.reduceFx === undefined) {
  SAVE.settings.reduceFx = matchMedia("(prefers-reduced-motion: reduce)").matches;
}
// effective reduced-motion = the explicit in-game toggle OR the live OS
// pref. The CSS animations already OR both (@media + [data-reducefx]); the
// showroom's 3D camera bob + ember spawns must honor the SAME contract, so
// an OS reduce-motion visitor who never opened Settings (SAVE flag false)
// still gets a frozen stage instead of a static UI over a bobbing scene.
const REDUCE_MOTION_MQ = matchMedia("(prefers-reduced-motion: reduce)");
function reduceMotion() { return SAVE.settings.reduceFx || REDUCE_MOTION_MQ.matches; }
// migrate the retired single MUTE into the two per-channel toggles: a
// player who muted everything before stays muted on both channels
if (SAVE.settings.mute) {
  SAVE.settings.musicOn = false;
  SAVE.settings.sfxOn = false;
  SAVE.settings.mute = false;
  SAVE.persistSettings();
}
Snd.settings = SAVE.settings;

// ---------- compatibility mode (no WebGL2) ----------
if (!R) {
  compatPanel.dataset.on = "1";
  document.getElementById("stage").dataset.compat = "1";
  throw new Error("BITCOIN KART needs WebGL2; compatibility panel shown");
}

// ---------- quality ----------
function applyQuality() {
  let q = SAVE.settings.quality;
  if (q === "auto") {
    const coarse = matchMedia("(pointer: coarse)").matches;
    const mem = navigator.deviceMemory || 8;
    q = !coarse && mem >= 8 ? "high" : mem >= 4 ? "medium" : "low";
  }
  R.setResScale(q === "high" ? 1 : q === "medium" ? 0.85 : 0.62);
  // Tier A post pipeline (bloom + grade): high/medium only, and never
  // under reduceFx · low tier + reduceFx keep the direct render path
  R.setPost(q !== "low" && !SAVE.settings.reduceFx);
  // one root flag the CSS uses to freeze every decorative animation
  // (title/menu entrance, PRESS START + daily glow) when the player asked
  // for reduced motion · prefers-reduced-motion is gated the same way
  document.documentElement.dataset.reducefx = SAVE.settings.reduceFx ? "1" : "0";
  return q;
}
applyQuality();

// ---------- shared scenes ----------
const showroom = createShowroom(R);
const atoll = createAtoll(R);
let selectedDriver = DEFAULT_DRIVER;
showroom.setDriver(selectedDriver, ROSTER.find((d) => d.id === selectedDriver).palette);

// ---------- state ----------
let state = "title"; // title menu select tracks hub race results codex
let overlay = null;  // settings | pause | null
let racePaused = false; // sim freeze · independent of which overlay is up

// optional X identity state · declared before any screen builds so the
// title screen can mount a Link X row (probe fires in the boot section)
let xLinkedName = null;
let xLinkEnabled = false;
let xLinkProbed = false;
const xLinkPaints = [];

// shared Link X row · gated on the sitewide feature being configured.
// Painted when the boot probe answers (or next microtask if it already
// has, so the row's parent is connected first).
function mountXLinkRow(parent, cls) {
  const idRow = el("div", "menu-xlink" + (cls ? " " + cls : ""));
  parent.appendChild(idRow);
  const paint = () => {
    if (!idRow.isConnected) return;
    idRow.textContent = "";
    if (xLinkedName) {
      idRow.appendChild(el("span", "menu-xlink-on", "racing as " + xLinkedName + " ✓"));
    } else if (xLinkEnabled) {
      const a = el("a", "menu-xlink-cta", "LINK X · race under your real handle →");
      a.href = "/api/auth/x/start?return=" + encodeURIComponent("/bitcoin-kart");
      idRow.appendChild(a);
    }
  };
  if (xLinkProbed) queueMicrotask(paint);
  else xLinkPaints.push(paint);
}
let race = null;
let raceCtx = null;  // { mode, trackId, cup, cupState, adventure }
// RACE SCHOOL first-play coach · lessons persist as storySeen "coach:*"
// beat ids (cloud OR-merged for free) · rocket-start nag counter is a
// device-local store key by design
const coach = createCoach({ storySeen, markStorySeen, store, settings: SAVE.settings });
let pendingAfterSelect = null;
let lastResults = null;
let pendingBalloonParty = null; // world id · the atoll celebrates on return

// debug-only unlock for testing (never advertised in UI)
// debug/QA hook: preview the finale credits copy without winning the run
if (location.search.indexOf("debug=credits") >= 0) {
  setTimeout(() => renderCredits(), 600);
}
if (location.search.indexOf("debug=satoshi") >= 0) {
  SAVE.progress.satoshiUnlocked = true;
}
// debug/QA hook: replay every story beat + cinematic (clears seen flags
// in memory only · nothing persists unless a beat actually re-fires)
if (location.search.indexOf("debug=story") >= 0) {
  SAVE.progress.storySeen = {};
}

// ---------- helpers ----------
function shareIntent(text) {
  return "https://x.com/intent/tweet?text=" + encodeURIComponent(text) + "&via=GalaxyMind";
}

// ---------- stage transition wipe ----------
// Every screen navigation runs under a sweeping slab: cover (0.16s), run
// the navigation at full cover (the synchronous track build hides here),
// reveal (0.2s). Timing lives on setTimeout chains, NEVER transitionend ·
// a dropped event must not soft-lock, and the finally below reveals even
// when the navigation throws, so the slab is structurally unable to stick
// covering the screen. Reduced motion (OS pref OR reduceFx · the
// playHubCine dual gate) cuts instantly. Nested go() calls while covered
// (startDaily -> startRace) run synchronously · callers that read `race`
// right after starting one stay correct. Pause/settings/cinema-skip are
// deliberately NOT routed through here (overlays, not navigations).
const wipeEl = el("div", "stage-wipe");
document.getElementById("stage").appendChild(wipeEl);
let wipeCovered = false; // navigation executing under full cover
let wipePending = null;  // latest navigation wins the in-flight cover
let wipeTimer = 0;
function go(fn) {
  if (reduceMotion() || wipeCovered) { fn(); return; }
  if (wipePending) { wipePending = fn; return; }
  wipePending = fn;
  clearTimeout(wipeTimer); // a live reset timer must not fire mid-cover
  if (wipeEl.dataset.phase === "out") {
    // re-navigating during the reveal: snap home so the sweep re-enters
    // from the left (the reflow commits the transition-less jump)
    delete wipeEl.dataset.phase;
    void wipeEl.offsetWidth;
  }
  wipeEl.dataset.phase = "in";
  wipeTimer = setTimeout(() => {
    const run = wipePending;
    wipePending = null;
    wipeCovered = true;
    try { run(); }
    finally {
      wipeCovered = false;
      wipeEl.dataset.phase = "out";
      wipeTimer = setTimeout(() => {
        if (wipeEl.dataset.phase === "out") delete wipeEl.dataset.phase;
      }, 230);
    }
  }, 180);
}

// ---------- hub cinematics driver (2026-07-21) ----------
// Runs an atoll camera script (hub.js startCine) under a DOM overlay:
// letterbox bars, timed lower-third cards, and a real SKIP control. One
// tap anywhere (or Enter/Escape) ends it · never a soft-lock. Reduced
// motion players never enter here; callers show toasts instead.
let hubCineTeardown = null;
function playHubCine(kind, cards, world, onDone) {
  if (hubCineTeardown) hubCineTeardown(false);
  const dur = atoll.startCine(kind, world);
  const ov = el("div", "cine-overlay");
  const barT = el("div", "hud-cinebar top");
  const barB = el("div", "hud-cinebar bot");
  const card = el("div", "hud-cinecard");
  const cLabel = el("div", "hud-cine-label");
  const cTitle = el("div", "hud-cine-title");
  const cLine = el("div", "hud-cine-line");
  card.append(cLabel, cTitle, cLine);
  const skipBtn = el("button", "btn small cine-skip-btn", "SKIP ›");
  skipBtn.type = "button";
  ov.append(barT, barB, card, skipBtn);
  document.getElementById("stage").appendChild(ov);
  uiRoot.dataset.cine = "1"; // hide the hub DOM · the reel owns the frame
  requestAnimationFrame(() => { barT.dataset.on = barB.dataset.on = "1"; });
  let cardIdx = -1;
  let closed = false;
  const finish = (invokeDone) => {
    if (closed) return;
    closed = true;
    if (hubCineTeardown === finish) hubCineTeardown = null;
    atoll.stopCine();
    window.removeEventListener("keydown", onKey);
    clearInterval(timer);
    ov.remove();
    uiRoot.dataset.cine = "0";
    if (invokeDone !== false && onDone) onDone();
  };
  hubCineTeardown = finish;
  const onKey = (e) => {
    if (e.key === "Enter" || e.key === "Escape" || e.key === " ") { e.preventDefault(); finish(true); }
  };
  window.addEventListener("keydown", onKey);
  ov.addEventListener("pointerdown", () => finish(true));
  skipBtn.addEventListener("click", (e) => { e.stopPropagation(); finish(true); });
  const timer = setInterval(() => {
    const info = atoll.cineInfo();
    if (!info || state !== "hub") { finish(state === "hub"); return; }
    while (cardIdx + 1 < cards.length && info.u >= cards[cardIdx + 1].at) {
      cardIdx += 1;
      const c = cards[cardIdx];
      cLabel.textContent = c.label || "";
      cTitle.textContent = c.title || "";
      cLine.textContent = c.line || "";
      card.dataset.on = "1";
      card.classList.remove("pop");
      void card.offsetWidth;
      card.classList.add("pop");
    }
  }, 80);
  return dur;
}

// ---------- story beats (first-visit gating · 2026-07-21) ----------
// One flat beatId -> true map in SAVE.progress, OR-merged across cloud so
// a chapter watched on the phone never re-fires on the laptop.
function storySeen(beatId) {
  const m = SAVE.progress.storySeen;
  return !!(m && m[beatId]);
}
function markStorySeen(beatId) {
  if (!beatId) return;
  if (!SAVE.progress.storySeen || typeof SAVE.progress.storySeen !== "object") {
    SAVE.progress.storySeen = {};
  }
  SAVE.progress.storySeen[beatId] = true;
  SAVE.persistProgress();
  queueCloudPush();
}

// Per-run share-card path segment · BYTE-FOR-BYTE mirror of encodeKartCard()
// in src/lib/kart-card.ts (static no-build game can't import it). Keep the
// field set + key letters + t/d/m/n/r/c/x order in lockstep · test-bitcoin-
// kart.ts evals this from source and compares against the lib.
function cardSeg(c) {
  const parts = [
    "t" + c.trackId,
    "d" + c.driverId,
    "m" + Math.max(1, Math.min(600000, Math.floor(c.timeMs))),
  ];
  if (c.day != null) parts.push("n" + c.day);
  // rank is the RACE GRID position (1..8) · clamp mirrors the lib encoder
  if (c.rank != null) parts.push("r" + Math.max(1, Math.min(8, Math.floor(c.rank))));
  if (c.klass) parts.push("c" + c.klass);
  if (c.mirror) parts.push("x1");
  // dare ghost id rides last (g<hex>) · deployed decoders ignore unknown
  // keys, so old card pages stay forward-compatible with dare cards
  if (c.ghostId && /^[a-f0-9]{8,16}$/.test(c.ghostId)) parts.push("g" + c.ghostId);
  return encodeURIComponent(parts.join("~"));
}

function cardUrl(fields) {
  return "galaxymind.space/bitcoin-kart/card/" + cardSeg(fields);
}

// Daily-share text: the {url} is the per-run card link, so the tweet
// unfurls a card frozen to THIS run instead of the generic game OG.
// The card's rank field is the RACE GRID position (1..8) · the daily
// BOARD rank (1..200) is a different number, so daily cards omit rank
// rather than lie "P8" for a #42 board placing (review 2026-07-14).
function dailyShareText(data, ghostId) {
  const t = trackById(raceCtx.trackId);
  return COPY.shareLines.daily
    .replace("{day}", String(raceCtx.day))
    .replace("{time}", fmtTime(data.timeMs))
    .replace("{track}", t.name)
    .replace("{url}", cardUrl({
      day: raceCtx.day,
      trackId: raceCtx.trackId,
      driverId: selectedDriver,
      timeMs: data.timeMs,
      klass: raceCtx.klass,
      mirror: raceCtx.mirror,
      ghostId: ghostId || null,
    }));
}

// mint-on-share: the FIRST share click opens the tab synchronously (so
// popup blockers stay friendly), mints this run's dare ghost, then points
// the tab at the final X intent whose card link carries ~g<id> · the card
// page CTA boots ?ghost=<id> straight into a race against this exact
// line. Repeat clicks reuse the minted id; no frames or a failed mint
// degrade silently to the dare-less share.
// ── photo share (share-funnel audit 2026-07-26) ─────────────────────
// The share artifact was a link card; X ranks native media above link
// posts. This captures the LIVE podium frame as a PNG. The GL context
// has no preserveDrawingBuffer (gl.js:428-432), so the pixels are only
// valid inside the same rAF tick that presented them · frame() runs
// the pending request right after race.render() on the results screen.
let photoReq = null;

function capturePhotoBlob(meta) {
  return new Promise((resolve) => {
    photoReq = () => {
      try {
        const gl = R.gl;
        const w = canvas.width, h = canvas.height;
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const bar = Math.max(48, Math.round(h * 0.09));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h + bar;
        const ctx = c.getContext("2d");
        // GL rows are bottom-up · flip while blitting
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
          img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        }
        ctx.putImageData(img, 0, 0);
        ctx.fillStyle = "#0A0A0B";
        ctx.fillRect(0, h, w, bar);
        const fs = Math.max(15, Math.round(bar * 0.34));
        ctx.font = "bold " + fs + "px ui-monospace, Menlo, monospace";
        ctx.textBaseline = "middle";
        const pad = Math.round(bar * 0.4);
        const rightText = "galaxymind.space/bitcoin-kart";
        const rightX = w - ctx.measureText(rightText).width - pad;
        ctx.fillStyle = "#9999A1";
        ctx.fillText(rightText, rightX, h + bar / 2);
        // left caption truncates before it can collide with the URL
        let left = "BITCOIN KART · " + meta.left;
        const maxW = rightX - pad * 2;
        if (ctx.measureText(left).width > maxW) {
          while (left.length > 4 && ctx.measureText(left + "…").width > maxW) {
            left = left.slice(0, -1);
          }
          left += "…";
        }
        ctx.fillStyle = "#F7931A";
        ctx.fillText(left, pad, h + bar / 2);
        c.toBlob((b) => resolve(b), "image/png");
      } catch {
        resolve(null); // capture is a bonus, never an error surface
      }
    };
  });
}

async function sharePhoto(meta, btn) {
  const orig = btn.textContent;
  btn.textContent = "📸 …";
  const blob = await capturePhotoBlob(meta);
  btn.textContent = orig;
  if (!blob) { btn.textContent = "📸 unavailable"; return; }
  const file = new File([blob], "bitcoin-kart.png", { type: "image/png" });
  // 1 · native share sheet (mobile) puts the PNG straight in the composer
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: meta.text });
      return;
    } catch { /* dismissed or denied · fall through */ }
  }
  // 2 · clipboard (desktop) · paste into the X composer
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    btn.textContent = "📸 COPIED · paste into your post";
    setTimeout(() => { btn.textContent = orig; }, 2600);
    return;
  } catch { /* clipboard unavailable · fall through */ }
  // 3 · plain download (an <a download> is not a CSP resource load)
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bitcoin-kart.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function wireDareShare(a, build, data) {
  const frames = data.ghost;
  if (!frames || frames.length < 10) return;
  const trackIdx = TRACKS.findIndex((x) => x.id === raceCtx.trackId);
  if (trackIdx < 0) return;
  let minted = null;
  let minting = null;
  a.addEventListener("click", (ev) => {
    if (minted) return; // href already carries the dare
    ev.preventDefault();
    const w = window.open("", "_blank");
    minting = minting || mintDareGhost({
      trackId: raceCtx.trackId,
      trackIdx,
      klass: raceCtx.klass,
      mirror: raceCtx.mirror,
      timeMs: data.timeMs,
      frames: quantizeGhost(frames),
    });
    minting.then((id) => {
      if (id) {
        minted = id;
        a.href = shareIntent(build(id));
      }
      if (w) w.location = a.href;
      else window.open(a.href, "_blank");
    }).catch(() => { if (w) w.location = a.href; });
  });
}

function driverName(id) {
  const d = ROSTER.find((x) => x.id === id);
  return d ? d.displayName : id;
}

function satoshiAvailable() {
  return SAVE.progress.satoshiUnlocked;
}

function worldOpen(worldId) {
  const w = WORLDS.find((x) => x.id === worldId);
  return SAVE.totalBalloons() >= (w ? w.cost : 0);
}

function eventState(t) {
  // returns { open, reason } · a locked node names its EXACT requirement
  // plus live progress so the player never has to guess how to open it
  // (unlock-clarity pass 2026-07-19).
  const total = SAVE.totalBalloons();
  if (!t.boss) {
    if (worldOpen(t.world)) return { open: true };
    const w = WORLDS.find((x) => x.id === t.world);
    return { open: false, reason: "Open " + w.door + " · " + total + "/" + w.cost + " balloons" };
  }
  const gate = GATES[t.id];
  if (total < gate.balloons) {
    return { open: false, reason: "Boss gate · " + total + "/" + gate.balloons + " balloons" };
  }
  const worldTracks = TRACKS.filter((x) => x.world === gate.world && !x.boss);
  const cleared = worldTracks.filter((wt) => SAVE.progress.balloons[wt.id] > 0).length;
  if (cleared < worldTracks.length) {
    return { open: false, reason: "Earn a balloon on every track first · " + cleared + "/" + worldTracks.length };
  }
  return { open: true };
}

function unlockedTracksForRacing() {
  return TRACKS.filter((t) => {
    if (!t.boss) return worldOpen(t.world);
    return SAVE.progress.bossBeaten[t.boss];
  });
}

function pickRivals(playerId, count) {
  const pool = ROSTER.filter((d) => d.id !== playerId && (d.id !== "satoshi" || satoshiAvailable()));
  // shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map((d) => d.id);
}

function checkSatoshiUnlock() {
  const p = SAVE.progress;
  if (p.satoshiUnlocked) return false;
  const total = SAVE.totalBalloons();
  const corporateAccess = total >= WORLDS.find((w) => w.id === "corporate").cost;
  if (corporateAccess && p.beatSchiff && total >= 12) {
    p.satoshiUnlocked = true;
    SAVE.persistProgress();
    Snd.sfx("unlock");
    return true;
  }
  return false;
}

// gild Satoshi + ready the atoll for golden hour. Idempotent · called on
// every hub/select entry and at boot. Also RETRO-GRANTS the flag when a
// save already meets 100% (a player who maxed out BEFORE this shipped, so
// they gild without a make-work race). Swapping the palette flows gold
// through the select tile, showroom and race (all read d.palette); both
// baked-mesh caches are busted in case satoshi was already cached silver.
function goldify() {
  const p = SAVE.progress;
  if (!p.goldenSatoshi && SAVE.totalBalloons() >= TRACKS.length * 3) {
    p.goldenSatoshi = true;
    SAVE.persistProgress();
  }
  if (!p.goldenSatoshi) return;
  const s = ROSTER.find((d) => d.id === "satoshi");
  if (s && s.palette !== GOLD_SATOSHI) {
    s.palette = GOLD_SATOSHI;
    clearKartMesh("satoshi");
    clearKartGL("satoshi");
  }
}

// 100%: every Orange Balloon (1st + full sat stack on all 12 tracks and
// bosses = TRACKS.length*3) means every level is cleared. Returns true the
// first time, for the results notification. Gilding is DEFERRED to
// goldify() on the next hub/select entry so a co-unlocked Genesis Run
// (satoshi + 100% on the SAME race, the boss-last completionist) still
// drives SILVER Satoshi in the story climax before the gold reveal.
function checkGoldenUnlock() {
  const p = SAVE.progress;
  if (p.goldenSatoshi) return false;
  if (SAVE.totalBalloons() >= TRACKS.length * 3) {
    p.goldenSatoshi = true;
    SAVE.persistProgress();
    Snd.sfx("unlock");
    return true;
  }
  return false;
}

// ---------- cross-device cloud save (X-linked players · 2026-07-18) ----------
// Progress follows the X login: one POST uploads this device's save AND
// pulls the cloud's, best-of merged server-side, so a device that is behind
// only GAINS. Silent no-op for anonymous / disabled / offline players.
let cloudPushT = null;
function cloudSyncNow(reRender) {
  if (!xLinkedName) return; // only linked players have a cloud save
  void cloudSyncKart({ progress: SAVE.progress, pbs: SAVE.pbs }).then((merged) => {
    if (!SAVE.applyCloud(merged)) return;
    goldify(); // a pulled 100% completion gilds Satoshi + the atoll
    if (reRender && state === "menu") renderMenu();
    else if (reRender && state === "hub") renderHub();
    // other screens (title/select/tracks) read fresh SAVE when next opened
  });
}
function queueCloudPush() {
  if (!xLinkedName) return;
  if (cloudPushT) clearTimeout(cloudPushT);
  cloudPushT = setTimeout(() => { cloudPushT = null; cloudSyncNow(false); }, 1500);
}

// ---------- input ----------
const keys = new Set();
let steerSmooth = 0;
const touch = { steer: 0, throttle: false, brake: false, drift: false, active: false, enabled: false };
let padItemHeld = false;
let padPauseHeld = false; // edge-detect the gamepad pause button (button[9])

// haptics: short buzzes on game events, touch devices only (Super Saylor
// lesson: feedback under the thumb sells impacts phones can't show)
function buzz(pattern) {
  if (!SAVE.settings.haptics || SAVE.settings.reduceFx) return;
  // phone vibration (touch sessions only · a laptop must never buzz a
  // paired phone) + controller rumble when a gamepad is driving (Tier 2)
  if (touch.enabled) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* unsupported */ }
  }
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected || !p.vibrationActuator) continue;
      const ms = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
      void p.vibrationActuator.playEffect("dual-rumble", {
        duration: Math.min(400, ms || 30),
        strongMagnitude: 0.55,
        weakMagnitude: 0.35,
      });
      break;
    }
  } catch { /* rumble unsupported · silent */ }
}

addEventListener("keydown", (e) => {
  if (e.repeat) return;
  unlockAudio();
  keys.add(e.code);
  if (state === "race" && race) {
    if (e.code === "Space") { e.preventDefault(); if (!racePaused) race.useItem(); }
    if (e.code === "Escape") togglePause();
    if (e.code === "Enter") race.skipIntro();
  } else if (state === "title" && (e.code === "Enter" || e.code === "Space")) {
    toMenu();
  } else if ((overlay === "settings" || overlay === "install") && e.code === "Escape") {
    closeOverlay();
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));

function pollGamepad(input) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p || !p.connected) continue;
    const ax = p.axes[0] || 0;
    if (Math.abs(ax) > 0.18) input.steer = clamp(-ax, -1, 1);
    if (p.buttons[0] && p.buttons[0].pressed) input.throttle = 1;
    if (p.buttons[1] && p.buttons[1].pressed) input.brake = true;
    if ((p.buttons[5] && p.buttons[5].pressed) || (p.buttons[7] && p.buttons[7].pressed)) input.drift = true;
    if (p.buttons[3] && p.buttons[3].pressed) input.lookBack = true;
    const itemNow = p.buttons[2] && p.buttons[2].pressed;
    if (itemNow && !padItemHeld && race && !racePaused) race.useItem();
    padItemHeld = !!itemNow;
    // edge-detect pause: a HELD button[9] used to toggle pause ~60x/sec
    const pauseNow = !!(p.buttons[9] && p.buttons[9].pressed);
    if (pauseNow && !padPauseHeld && state === "race") togglePause();
    padPauseHeld = pauseNow;
    break;
  }
}

function readInput(dt) {
  // debug/test autopilot: window.__BK_AUTO = true hands the player kart to
  // the CPU brain (never surfaced in UI; used by automated verification)
  if (window.__BK_AUTO && race && state === "race") return race.autopilot(dt);
  // NOTE on signs: in world space positive yaw turns toward +X, which the
  // chase camera shows on the LEFT of the screen. So screen-right steering
  // is NEGATIVE yaw: left key adds, right key subtracts (verified in-game).
  let target = 0;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) target += 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) target -= 1;
  if (touch.active) {
    const mag = Math.abs(touch.steer);
    target = -Math.sign(touch.steer) * Math.pow(mag, 0.85);
  }
  steerSmooth += clamp(target - steerSmooth, -7 * dt, 7 * dt);
  if (target === 0 && !touch.active) steerSmooth *= Math.max(0, 1 - 9 * dt);
  let throttle = keys.has("ArrowUp") || keys.has("KeyW") || touch.throttle ? 1 : 0;
  let brake = keys.has("ArrowDown") || keys.has("KeyS") || touch.brake;
  // auto-accelerate (touch): the kart drives itself forward, thumbs own
  // steering + drift, BRAKE overrides
  if (touch.enabled && SAVE.settings.autoAccel) {
    throttle = touch.brake ? 0 : 1;
    brake = touch.brake;
  }
  const input = {
    throttle,
    brake,
    steer: clamp(steerSmooth, -1, 1),
    drift: keys.has("ShiftLeft") || keys.has("ShiftRight") || touch.drift,
    // Coarse-pointer drift only. Keyboard and AI keep the sharp model.
    touchAssist: !!(touch.enabled && (touch.active || touch.drift)),
    skip: keys.has("Enter"),
    lookBack: keys.has("KeyC"),
    // the start ritual needs to know a held throttle is the machine's,
    // not the player's (race.js jump-start exception · 2026-07-21)
    autoGas: touch.enabled && SAVE.settings.autoAccel,
  };
  pollGamepad(input);
  if (race) race.player.steer = input.steer;
  return input;
}

// touch controls · two styles behind settings.touchStyle (Super Saylor
// pattern): "joystick" = floating analog steer that spawns under the thumb
// anywhere on the left half; "slider" = the fixed horizontal steer zone.
// Buttons are square hit zones with the visible circle on ::before so edge
// taps land (the SS pad fix), and auto-accel swaps GAS for BRAKE.
function buildTouch() {
  touch.enabled = matchMedia("(pointer: coarse)").matches;
  if (!touch.enabled) return;
  touchRoot.textContent = "";
  touch.steer = 0; touch.throttle = false; touch.brake = false; touch.drift = false; touch.active = false;

  // ----- steering (left half) -----
  let steerId = null;
  if (SAVE.settings.touchStyle === "slider") {
    const steerZone = el("div", "t-steer");
    const steerKnob = el("div", "t-knob");
    steerZone.appendChild(steerKnob);
    touchRoot.appendChild(steerZone);
    const moveSteer = (e) => {
      if (e.pointerId !== steerId) return;
      const r = steerZone.getBoundingClientRect();
      const v = clamp(((e.clientX - r.left) / r.width - 0.5) * 2.4, -1, 1);
      touch.steer = v;
      steerKnob.style.left = (50 + v * 34) + "%";
    };
    steerZone.addEventListener("pointerdown", (e) => {
      steerId = e.pointerId;
      try { steerZone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      touch.active = true;
      moveSteer(e);
    });
    steerZone.addEventListener("pointermove", moveSteer);
    const endSteer = (e) => {
      if (e.pointerId !== steerId) return;
      steerId = null;
      touch.active = false;
      touch.steer = 0;
      steerKnob.style.left = "50%";
    };
    steerZone.addEventListener("pointerup", endSteer);
    steerZone.addEventListener("pointercancel", endSteer);
  } else {
    // floating joystick: base appears where the thumb lands
    const zone = el("div", "t-joyzone");
    const base = el("div", "t-joybase");
    const stick = el("div", "t-joystick");
    base.appendChild(stick);
    base.dataset.on = "0";
    zone.appendChild(base);
    touchRoot.appendChild(zone);
    let baseX = 0;
    const move = (e) => {
      if (e.pointerId !== steerId) return;
      const v = clamp((e.clientX - baseX) / 55, -1, 1);
      touch.steer = v;
      stick.style.transform = "translate(calc(-50% + " + (v * 30) + "px), -50%)";
    };
    zone.addEventListener("pointerdown", (e) => {
      steerId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      touch.active = true;
      baseX = e.clientX;
      const zr = zone.getBoundingClientRect();
      base.style.left = (e.clientX - zr.left) + "px";
      base.style.top = (e.clientY - zr.top) + "px";
      base.dataset.on = "1";
      unlockAudio();
      move(e);
    });
    zone.addEventListener("pointermove", move);
    const end = (e) => {
      if (e.pointerId !== steerId) return;
      steerId = null;
      touch.active = false;
      touch.steer = 0;
      base.dataset.on = "0";
      stick.style.transform = "translate(-50%, -50%)";
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  // ----- right-hand buttons -----
  const auto = SAVE.settings.autoAccel;
  const btnMain = el("button", "t-btn t-main", auto ? "DRIFT" : "GAS");
  const btnSide = el("button", "t-btn t-side", auto ? "BRAKE" : "DRIFT");
  const btnI = el("button", "t-btn t-item", "ITEM");
  const btnP = el("button", "t-btn t-pause", "❚❚");
  touchRoot.append(btnI, btnSide, btnMain, btnP);
  touchRoot.dataset.on = "1";

  const hold = (btn, prop) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      unlockAudio();
      // Capture so a thumb that jitters off the circle keeps the hold.
      // Leaving the button used to drop DRIFT mid-corner.
      try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      touch[prop] = true;
      btn.dataset.on = "1";
    });
    const off = (e) => {
      if (e && e.pointerId != null) {
        try { btn.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      }
      touch[prop] = false;
      btn.dataset.on = "0";
    };
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
  };
  hold(btnMain, auto ? "drift" : "throttle");
  hold(btnSide, auto ? "brake" : "drift");
  btnI.addEventListener("pointerdown", (e) => { e.preventDefault(); if (race && !racePaused) race.useItem(); });
  btnP.addEventListener("pointerdown", (e) => { e.preventDefault(); togglePause(); });
}
buildTouch();

// iOS pinch-zoom + double-tap-zoom + selection kill (Super Saylor lesson:
// a race is exactly the gesture soup Safari loves to zoom and select on,
// and a stuck page-zoom only clears with a refresh).
for (const evt of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(evt, (e) => e.preventDefault());
}
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350 && e.target && e.target.closest && e.target.closest("#stage")) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener("touchmove", (e) => {
  // Results and menus scroll. A race lock must not swallow that pan.
  if (e.target && e.target.closest && e.target.closest(".scr")) return;
  const inStage = e.target && e.target.closest && e.target.closest("#stage");
  if (!inStage) return;
  // any multi-finger move in the stage, or any move mid-race, is game
  // input, never a browser pan/pinch
  if (e.touches.length > 1 || state === "race") e.preventDefault();
}, { passive: false });
const stageEl = document.getElementById("stage");
stageEl.addEventListener("selectstart", (e) => e.preventDefault());
stageEl.addEventListener("dragstart", (e) => e.preventDefault());

// ---------- audio unlock + lifecycle ----------
let audioReady = false;
function unlockAudio() {
  if (audioReady) return;
  audioReady = true;
  Snd.init();
  Snd.applyVolumes();
  stateMusic();
}
addEventListener("pointerdown", unlockAudio, { once: false });

// ---------- persistent audio toggles (marquee header) ----------
// Always-visible Music + SFX on/off, reachable on every screen including
// mid-race (the marquee stays above the stage). They share state with the
// SETTINGS overlay's toggles via paintAudioToggles + an openSettings sync.
const audBtns = {
  music: document.querySelector('.aud-toggle[data-aud="music"]'),
  sfx: document.querySelector('.aud-toggle[data-aud="sfx"]'),
};
const AUD_KEY = { music: "musicOn", sfx: "sfxOn" };
function paintAudioToggles() {
  for (const kind in audBtns) {
    const btn = audBtns[kind];
    if (!btn) continue;
    const on = SAVE.settings[AUD_KEY[kind]] !== false;
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const st = btn.querySelector(".aud-state");
    if (st) st.textContent = on ? "ON" : "OFF";
  }
}
function toggleAudio(kind) {
  const key = AUD_KEY[kind];
  // flip BEFORE unlockAudio: on the first-ever interaction unlockAudio
  // starts a theme whose un-duck ramp reads the toggle state, so it must
  // already be flipped (adversarial review 2026-07-15)
  SAVE.settings[key] = SAVE.settings[key] === false;
  unlockAudio();
  Snd.applyVolumes();
  SAVE.persistSettings();
  paintAudioToggles();
  // audible confirmation only while SFX is on
  if (SAVE.settings.sfxOn !== false) Snd.sfx("click");
  if (overlay === "settings") openSettings(); // keep the overlay in sync
}
for (const kind in audBtns) {
  if (audBtns[kind]) audBtns[kind].addEventListener("click", (e) => {
    toggleAudio(kind);
    // pointer click keeps focus otherwise, so a later stray Enter would
    // re-toggle · keyboard activation (detail 0) keeps focus intentionally
    if (e.detail > 0) e.currentTarget.blur();
  });
}
paintAudioToggles();

// keep the toggles reachable when a touch race fullscreens #stage: the
// marquee is a sibling ABOVE <main>, excluded from the fullscreen element,
// so relocate the SAME node into the stage (state + handlers ride along)
// and dock it below the lap chip · back to the marquee on exit.
{
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const marquee = document.getElementById("marquee");
  const stageEl = document.getElementById("stage");
  const cluster = document.querySelector(".audio-toggles");
  const relocate = () => {
    if (!cluster) return;
    if (fsEl() === stageEl) {
      cluster.classList.add("in-stage");
      stageEl.appendChild(cluster);
    } else if (cluster.classList.contains("in-stage")) {
      cluster.classList.remove("in-stage");
      const cta = marquee.querySelector(".cta");
      if (cta) marquee.insertBefore(cluster, cta);
      else marquee.appendChild(cluster);
    }
  };
  document.addEventListener("fullscreenchange", relocate);
  document.addEventListener("webkitfullscreenchange", relocate);
}
// tap anywhere skips the pre-race flyby (mobile players have no Enter key)
document.getElementById("stage").addEventListener("pointerdown", () => {
  if (state === "race" && race) race.skipIntro();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    Snd.suspend();
    // a call or app switch mid-race should never cost the race
    if (state === "race" && !racePaused && race && race.getPhase() !== "over") togglePause();
    releaseWakeLock();
  } else {
    // still race-paused → stay silent until the player hits RESUME
    if (!racePaused) Snd.resume();
    if (state === "race") requestWakeLock();
  }
});

// ---------- race session hardware (mobile) ----------
// fullscreen + landscape lock + wake lock while racing. All best-effort:
// iOS supports none of it gracefully and that is fine.
let wakeLock = null;
async function requestWakeLock() {
  try {
    if (navigator.wakeLock && !wakeLock) wakeLock = await navigator.wakeLock.request("screen");
  } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch { wakeLock = null; }
}
async function enterRaceSession() {
  if (!touch.enabled) return;
  requestWakeLock();
  const stage = document.getElementById("stage");
  try {
    if (!document.fullscreenElement && stage.requestFullscreen) {
      await stage.requestFullscreen({ navigationUI: "hide" });
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch { /* not supported (iOS) or denied: play on */ }
}
function exitRaceSession() {
  releaseWakeLock();
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* fine */ }
}

// ---------- rotate-to-landscape hint (Super Saylor pattern) ----------
function initRotateHint() {
  if (!touch.enabled) return;
  const KEY = "gm:bk:rot-hint";
  try { if (sessionStorage.getItem(KEY)) return; } catch { /* private mode */ }
  const mq = matchMedia("(orientation: portrait)");
  if (!mq.matches) return;
  const hint = el("div", "rot-hint");
  hint.append(el("div", "rot-hint-phone", "📱"), el("div", "rot-hint-text", "ROTATE FOR THE FULL CIRCUIT"));
  document.getElementById("stage").appendChild(hint);
  const dismiss = () => {
    hint.remove();
    try { sessionStorage.setItem(KEY, "1"); } catch { /* fine */ }
    mq.removeEventListener("change", onFlip);
  };
  const onFlip = (e) => { if (!e.matches) dismiss(); };
  hint.addEventListener("pointerdown", dismiss);
  mq.addEventListener("change", onFlip);
}
initRotateHint();

// ---------- add-to-home-screen funnel (Super Saylor pattern) ----------
let a2hsPrompt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  a2hsPrompt = e;
});
const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function canOfferInstall() {
  return !STANDALONE && touch.enabled && (a2hsPrompt !== null || IOS);
}
function offerInstall() {
  if (a2hsPrompt) {
    a2hsPrompt.prompt();
    a2hsPrompt.userChoice.finally(() => { a2hsPrompt = null; renderMenu(); });
    return;
  }
  // iOS has no install prompt API: coach the share-sheet path. Its own
  // overlay id (not "settings") so a header audio toggle's sync re-render
  // never replaces this card (adversarial review 2026-07-15)
  overlay = "install";
  overlayRoot.textContent = "";
  overlayRoot.dataset.on = "1";
  const box = el("div", "overlay-box");
  box.appendChild(el("h3", "overlay-title", "ADD TO HOME SCREEN"));
  box.appendChild(el("p", "a2hs-step", "1 · Tap the Share button in Safari"));
  box.appendChild(el("p", "a2hs-step", "2 · Scroll and tap Add to Home Screen"));
  box.appendChild(el("p", "a2hs-step", "3 · Bitcoin Kart installs like an app and plays offline"));
  box.appendChild(button("CLOSE", "primary", () => closeOverlay()));
  overlayRoot.appendChild(box);
}
function maybeShowInstallCard(parent) {
  if (!canOfferInstall()) return;
  if (store.get("a2hs-hint", false)) return;
  const card = el("div", "a2hs-card");
  card.appendChild(el("span", "a2hs-copy", "📲 Install Bitcoin Kart · full screen, plays offline"));
  const row = el("div", "a2hs-row");
  row.appendChild(button("INSTALL", "small", () => offerInstall()));
  row.appendChild(button("NOT NOW", "small", () => { store.set("a2hs-hint", true); card.remove(); }));
  card.appendChild(row);
  parent.appendChild(card);
}

// ---------- first-race onboarding ----------
// desktop twin of the touch hint: same .touch-hint class so holdIntro
// freezes the flyby for both until the player dismisses it.
// RACE SCHOOL splash (2026-07-21): glyph rows instead of prose lines ·
// each row is [key chips] [what it does], built with el() only.
function hintRow(chips, label) {
  const row = el("div", "hint-row");
  const keys = el("span", "hint-keys");
  for (const c of chips) keys.appendChild(el("span", "coach-key", c));
  row.appendChild(keys);
  row.appendChild(el("span", "hint-what", label));
  return row;
}
function hintCard(rows, tapLine) {
  const hint = el("div", "touch-hint");
  hint.appendChild(el("div", "hint-eyebrow", "RACE SCHOOL"));
  hint.appendChild(el("div", "hint-title", "KNOW YOUR MACHINE"));
  for (const r of rows) hint.appendChild(r);
  hint.appendChild(el("div", "touch-hint-tap", tapLine));
  return hint;
}
function maybeShowKeyHint() {
  if (touch.enabled || store.get("kb-hint", false)) return;
  const hint = hintCard([
    hintRow(["◀ ▶", "A D"], "steer"),
    hintRow(["▲", "W"], "gas · tap it just before GO for a ROCKET START"),
    hintRow(["SHIFT"], "hold to drift · release for a MINI TURBO"),
    hintRow(["SPACE"], "fire your item"),
    hintRow(["C"], "look back"),
    hintRow(["ESC"], "pause"),
  ], "click or press any key to race");
  const dismiss = () => {
    hint.remove();
    store.set("kb-hint", true);
    removeEventListener("keydown", dismiss);
  };
  hint.addEventListener("pointerdown", dismiss);
  addEventListener("keydown", dismiss);
  document.getElementById("stage").appendChild(hint);
}
function maybeShowTouchHint() {
  if (!touch.enabled) { maybeShowKeyHint(); return; }
  if (store.get("touch-hint", false)) return;
  const auto = SAVE.settings.autoAccel;
  const rows = [
    hintRow(["◀ ▶"], SAVE.settings.touchStyle === "slider" ? "steer with the left pad" : "touch and drag the left side to steer"),
    auto
      ? hintRow(["GAS"], "is automatic · hold BRAKE on the count, release on the 1 for a ROCKET START")
      : hintRow(["GAS"], "hold to drive · tap it just before GO for a ROCKET START"),
    hintRow(["DRIFT"], "hold through corners · release for a MINI TURBO"),
    hintRow(["ITEM"], "fires your pickup"),
    hintRow(["SATS"], "on the track raise your top speed"),
  ];
  const hint = hintCard(rows, "tap to race");
  hint.addEventListener("pointerdown", () => {
    hint.remove();
    store.set("touch-hint", true);
  });
  document.getElementById("stage").appendChild(hint);
}

function stateMusic() {
  if (!audioReady) return;
  if (state === "race") {
    // the race owns its theme from GO · stop the menu theme NOW so the
    // flyby + countdown are actually silent (its tails ring into
    // silence, not under the track theme · overlap audit 2026-07-15)
    Snd.stopTheme();
    return;
  }
  if (state === "results") return; // finishRace picks victory vs results
  if (state === "hub") {
    Snd.playTheme("atoll");
    Snd.ambience("surf"); // the atoll is an island: waves + gulls
  } else {
    Snd.playTheme("title");
    Snd.ambience(null);
  }
}

// ---------- screens ----------
const screens = {};
function screen(id) {
  const s = el("section", "scr");
  s.id = "scr-" + id;
  uiRoot.appendChild(s);
  screens[id] = s;
  return s;
}

// screen-scoped intervals: show() hides screens by dataset.on without
// detaching them, so an interval that self-clears only on !isConnected
// would run forever on a hidden screen. Register them here and clear on
// leaving the owning screen (bug sweep 2026-07-15).
const screenTimers = [];
function screenInterval(fn, ms, ownerScreen) {
  const idv = setInterval(fn, ms);
  screenTimers.push({ idv, screen: ownerScreen });
  return idv;
}
function show(id) {
  state = id;
  for (let i = screenTimers.length - 1; i >= 0; i--) {
    if (screenTimers[i].screen !== id) { clearInterval(screenTimers[i].idv); screenTimers.splice(i, 1); }
  }
  // the race object lives on through the podium/results (for rematch), but
  // its per-world ambience bed + gull/drip timers should not run under the
  // results screen · a rematch restarts them via buildTrack (bug sweep)
  if (id === "results") Snd.ambience(null);
  for (const k in screens) screens[k].dataset.on = k === id ? "1" : "0";
  hudRoot.dataset.on = id === "race" ? "1" : "0";
  touchRoot.dataset.race = id === "race" ? "1" : "0";
  document.getElementById("stage").dataset.race = id === "race" ? "1" : "0";
  // leave the fullscreen race session when back at the front door
  if (id === "menu" || id === "title") exitRaceSession();
  // the shared showroom backdrop mirrors the screen: cinematic on the
  // title, wider on the menu, clean turntable everywhere it stands in
  showroom.setMode(id === "title" ? "title" : id === "menu" ? "menu" : "select");
  stateMusic();
}

function button(label, cls, fn) {
  const b = el("button", "btn " + (cls || ""), label);
  b.addEventListener("click", () => { unlockAudio(); Snd.sfx("click"); fn(); });
  return b;
}

// ----- title -----
{
  const s = screen("title");
  const box = el("div", "title-box");
  const eyebrow = el("div", "eyebrow", "GALAXY MIND ARCADE");
  const logo = el("h2", "logo");
  logo.append(el("span", "logo-bit", "BITCOIN"), el("span", "logo-kart", "KART"));
  const tag = el("p", "tagline", TAGLINE);
  const start = button("PRESS START", "primary big", () => toMenu());
  const intro = el("p", "intro-copy", COPY.intro);
  const legal = el("p", "title-legal", "unofficial fan game and affectionate parody · not financial advice · no Nintendo affiliation");
  box.append(eyebrow, logo, tag, start);
  // everything below the one bright action recedes into a quiet foot
  // cluster · Link X sits on the FRONT DOOR (operator call 2026-07-14):
  // claiming your real handle before the first race is the return-traffic
  // hook, but it must never compete with PRESS START
  const foot = el("div", "title-foot");
  mountXLinkRow(foot, "title-xlink");
  foot.append(intro, legal);
  box.append(foot);
  s.appendChild(box);
}

function toMenu() { Snd.sfx("click"); go(() => { renderMenu(); show("menu"); }); }

// ----- menu -----
{
  screen("menu");
}
function renderMenu() {
  const s = screens.menu;
  s.textContent = "";
  const box = el("div", "menu-box");

  // compact wordmark · echoes the title logo so the menu reads as the same
  // game (mono eyebrow over BITCOIN orange + KART white), not a web form
  const brand = el("div", "menu-brand");
  const wm = el("h2", "menu-wordmark");
  wm.append(el("span", "wm-bit", "BITCOIN"), el("span", "wm-kart", "KART"));
  brand.append(el("div", "menu-eyebrow", "GALAXY MIND ARCADE"), wm);
  box.appendChild(brand);

  // driver + balloons read as one HUD status strip
  const drv = ROSTER.find((d) => d.id === selectedDriver);
  const status = el("div", "menu-status");
  const drvGroup = el("div", "menu-driver");
  drvGroup.append(
    el("span", "menu-team-pip " + drv.side),
    el("span", "menu-driver-label", "DRIVER"),
    el("span", "menu-driver-name", drv.displayName),
  );
  status.append(
    drvGroup,
    el("div", "menu-balloons", "🎈 " + SAVE.totalBalloons() + " " + COPY.adventure.balloonLabel),
    button("CHANGE", "small", () => { pendingAfterSelect = "menu"; go(() => { renderSelect(); show("select"); }); }),
  );
  box.appendChild(status);

  // mode grid · Adventure is the flagship (full-width hero), the four race
  // modes sit in a 2-up sub-grid, Settings is a quiet full-width utility
  const grid = el("div", "menu-grid");
  grid.appendChild(button("ADVENTURE", "primary menu-hero", () => go(() => { renderHub(); show("hub"); })));
  const modes = el("div", "menu-modes");
  modes.append(
    button("GRAND PRIX", "", () => go(() => { renderTracks("gp"); show("tracks"); })),
    button("QUICK RACE", "", () => go(() => { renderTracks("quick"); show("tracks"); })),
    button("TIME TRIAL", "", () => go(() => { renderTracks("tt"); show("tracks"); })),
    button("SHELF · CODEX", "", () => go(() => { renderCodex(); show("codex"); })),
  );
  grid.appendChild(modes);
  grid.appendChild(button("SETTINGS", "menu-util", () => openSettings()));
  box.appendChild(grid);

  // Daily Circuit: one combo per UTC day, shared board, everyone races it ·
  // structured CTA (kicker / track / class) so the hierarchy reads at a glance
  const day = kartDayNumber(Date.now());
  const combo = dailyCombo(day);
  const t = trackById(combo.trackId);
  const daily = el("button", "btn daily menu-daily");
  daily.append(
    el("span", "daily-kicker", "🏁 DAILY CIRCUIT #" + day),
    el("span", "daily-track", t.name),
    el("span", "daily-class", CLASSES[combo.klass].name + (combo.mirror ? " · MIRROR" : "")),
  );
  daily.addEventListener("click", () => { unlockAudio(); Snd.sfx("click"); startDaily(); });
  box.appendChild(daily);

  // TODAY'S BOARD (social board 2026-07-17): the leaderboard is the front
  // door's centerpiece · top 3 with X avatars, your heat around your own
  // row, and the reclaim call-out when someone took your spot since you posted
  mountMenuBoard(box, day);

  // utilities recede into a quiet foot cluster below the social loop
  const foot = el("div", "menu-foot");
  // optional X identity row (shared helper · plain top-level <a>
  // navigation, so the game's strict CSP is untouched)
  mountXLinkRow(foot);
  if (canOfferInstall()) {
    foot.appendChild(button("📲 ADD TO HOME SCREEN", "small", () => offerInstall()));
  }
  const links = el("div", "menu-links");
  const a1 = el("a", "menu-link", "The Arcade →"); a1.href = "/arcade";
  const a2 = el("a", "menu-link", "Want the platformer? Super Saylor →"); a2.href = "/super-saylor";
  links.append(a1, a2);
  foot.appendChild(links);
  box.appendChild(foot);

  s.appendChild(box);
}

// ----- select -----
{
  screen("select");
}
function renderSelect() {
  goldify(); // gild + retro-grant before the tile/showroom read the palette
  const s = screens.select;
  s.textContent = "";
  const wrap = el("div", "select-wrap");
  const head = el("div", "select-head");
  head.append(el("h2", "scr-title", "CHOOSE YOUR RACER"), button("← BACK", "small", () => backFromSelect()));
  wrap.appendChild(head);
  const cols = el("div", "select-cols");
  const grid = el("div", "select-grid");
  const panel = el("div", "select-panel");
  cols.append(grid, panel);
  wrap.appendChild(cols);
  s.appendChild(wrap);

  const order = ["saylor", "phong", "wizard", "mallers", "bukele", "satoshi", "schiff", "dimon", "warren", "buffett", "cuban"];
  const tiles = {};
  for (const id of order) {
    const d = ROSTER.find((x) => x.id === id);
    const locked = id === "satoshi" && !satoshiAvailable();
    const goldSat = id === "satoshi" && SAVE.progress.goldenSatoshi;
    const tile = el("button", "sel-tile" + (locked ? " locked" : "") + (goldSat ? " gold" : ""));
    tile.style.setProperty("--tile", d.palette.body);
    tile.style.setProperty("--tile2", d.palette.accent);
    tile.append(
      el("span", "sel-tag " + d.side + (goldSat ? " gold" : ""), locked ? "???" : goldSat ? "★ GOLDEN" : COPY.teams[d.side]),
      el("span", "sel-name", locked ? "???" : d.displayName),
    );
    tile.addEventListener("click", () => {
      unlockAudio();
      if (locked) { Snd.sfx("wrong"); paintPanel(d, true); return; }
      Snd.sfx("stinger", order.indexOf(id));
      selectedDriver = id;
      showroom.setDriver(id, d.palette);
      for (const t in tiles) tiles[t].dataset.sel = t === id ? "1" : "0";
      paintPanel(d, false);
    });
    tiles[id] = tile;
    grid.appendChild(tile);
  }

  function paintPanel(d, locked) {
    panel.textContent = "";
    if (locked) {
      panel.append(
        el("h3", "sel-panel-name", "???"),
        el("p", "sel-bio", d.lockHint),
        el("p", "sel-lockreq", "TO RECOVER THE SIGNAL:"),
      );
      // live checklist (not a static string) so the player sees exactly how
      // far along the Satoshi unlock they are (unlock-clarity pass 2026-07-19)
      panel.appendChild(checklistEl(satoshiReqs()));
      return;
    }
    panel.append(el("h3", "sel-panel-name", d.displayName));
    if (d.handle) panel.append(el("div", "sel-handle", d.handle));
    panel.append(
      el("div", "sel-kart-name", d.kartName + " · " + COPY.teams[d.side]),
      el("p", "sel-bio", d.bio),
    );
    const bars = el("div", "sel-stats");
    for (const [label, v] of statBars(d.stats)) {
      const row = el("div", "sel-stat");
      row.appendChild(el("span", "sel-stat-label", label));
      const bar = el("div", "sel-bar");
      const fill = el("div", "sel-bar-fill");
      fill.style.width = (v * 10) + "%";
      bar.appendChild(fill);
      row.appendChild(bar);
      bars.appendChild(row);
    }
    panel.appendChild(bars);
    panel.append(el("p", "sel-sig", "SIGNATURE · " + d.signature));
    // taunts cycle while the panel is up · the roster sells itself
    // (interval self-clears when paintPanel replaces the element)
    const tauntEl = el("p", "sel-taunt", "“" + d.taunts[0] + "”");
    panel.append(tauntEl);
    let ti = 0;
    const tid = screenInterval(() => {
      if (!tauntEl.isConnected) { clearInterval(tid); return; }
      ti = (ti + 1) % d.taunts.length;
      tauntEl.textContent = "“" + d.taunts[ti] + "”";
    }, 2400, "select");
    panel.appendChild(button("CONFIRM →", "primary", () => backFromSelect()));
  }

  tiles[selectedDriver].dataset.sel = "1";
  paintPanel(ROSTER.find((x) => x.id === selectedDriver), false);
}

function backFromSelect() {
  if (pendingAfterSelect === "menu" || !pendingAfterSelect) go(() => { renderMenu(); show("menu"); });
  pendingAfterSelect = null;
}

// ----- tracks / cups -----
{
  screen("tracks");
}
function renderTracks(mode) {
  const s = screens.tracks;
  s.textContent = "";
  const wrap = el("div", "tracks-wrap");
  const head = el("div", "select-head");
  head.append(
    el("h2", "scr-title", mode === "gp" ? "PICK A CUP" : mode === "tt" ? "TIME TRIAL" : "QUICK RACE"),
    button("← BACK", "small", () => go(() => { renderMenu(); show("menu"); })),
  );
  wrap.appendChild(head);

  // engine class + mirror chips (persisted; adventure stays pure BITS)
  const chips = el("div", "class-row");
  chips.appendChild(el("span", "set-label", "CLASS"));
  for (const key of ["sats", "bits", "fullsend"]) {
    chips.appendChild(button(CLASSES[key].name, "small" + (SAVE.settings.raceClass === key ? " sel" : ""), () => {
      SAVE.settings.raceClass = key;
      SAVE.persistSettings();
      renderTracks(mode);
    }));
  }
  chips.appendChild(el("span", "set-label class-gap", "MIRROR"));
  chips.appendChild(button(SAVE.settings.raceMirror ? "ON" : "OFF", "small" + (SAVE.settings.raceMirror ? " sel" : ""), () => {
    SAVE.settings.raceMirror = !SAVE.settings.raceMirror;
    SAVE.persistSettings();
    renderTracks(mode);
  }));
  // one-liner so the picker teaches itself
  const klassSel = SAVE.settings.raceClass || "bits";
  chips.appendChild(el("span", "class-note", CLASSES[klassSel].desc + (SAVE.settings.raceMirror ? " · " + MIRROR_DESC : "")));
  if (mode === "tt") chips.appendChild(el("span", "class-note", "PBs + ghosts save on BITS without mirror"));
  wrap.appendChild(chips);

  if (mode === "gp") {
    const grid = el("div", "cup-grid");
    for (const cup of CUPS) {
      const open = worldOpen(cup.id);
      const card = el("button", "cup-card" + (open ? "" : " locked"));
      card.append(el("span", "cup-name", cup.name));
      const names = cup.events.map((e) => trackById(e).name).join(" · ");
      card.append(el("span", "cup-tracks", names));
      const trophy = SAVE.progress.cups[cup.id];
      if (trophy) card.append(el("span", "cup-trophy", trophy === 1 ? "🏆 GOLD" : trophy === 2 ? "🥈 SILVER" : "🥉 BRONZE"));
      if (!open) card.append(el("span", "cup-lock", COPY.adventure.doorLocked));
      card.addEventListener("click", () => {
        if (!open) { Snd.sfx("wrong"); return; }
        Snd.sfx("click");
        startCup(cup);
      });
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
  } else {
    const grid = el("div", "track-grid");
    const avail = unlockedTracksForRacing();
    for (const t of TRACKS) {
      const open = avail.includes(t);
      const card = el("button", "track-card" + (open ? "" : " locked"));
      card.dataset.world = t.world;
      card.append(el("span", "track-world", (WORLDS.find((w) => w.id === t.world) || {}).name || t.world));
      card.append(el("span", "track-name", t.name));
      if (t.boss) card.append(el("span", "track-boss", "BOSS"));
      if (mode === "tt" && SAVE.pbs[t.id]) card.append(el("span", "track-pb", "PB " + fmtTime(SAVE.pbs[t.id])));
      if (!open) card.append(el("span", "cup-lock", "Locked · open it in Adventure"));
      card.addEventListener("click", () => {
        if (!open) { Snd.sfx("wrong"); return; }
        Snd.sfx("click");
        startRace({ mode, trackId: t.id });
      });
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
  }
  s.appendChild(wrap);
}

// ----- unlock-progress helpers (2026-07-19) -----
// ONE place computes "how do I unlock the big rewards" so the hub, the
// results screen and the select panel never drift. Every unlockable states
// its requirement AND live progress, so nothing is ever a guess.
function satoshiReqs() {
  const p = SAVE.progress;
  const total = SAVE.totalBalloons();
  const corpCost = WORLDS.find((w) => w.id === "corporate").cost;
  return [
    { label: "Open the Corporate Gate", done: total >= corpCost, note: total + "/" + corpCost + " balloons" },
    { label: "Beat Schiff at the Gold Mine", done: !!p.beatSchiff },
    { label: "Hold twelve Orange Balloons", done: total >= 12, note: total + "/12" },
  ];
}
// a results award that represents a genuine UNLOCK (vs a routine balloon /
// codex line) · these get the celebratory card treatment on the results screen
function isUnlockAward(a) {
  return a.includes(COPY.adventure.satoshiUnlocked) ||
    a.includes(COPY.adventure.goldenSatoshi) ||
    a.indexOf("NEW WORLD OPEN") >= 0 ||
    a.indexOf("BOSS CLEARED") >= 0;
}
function checklistEl(items) {
  const box = el("div", "unlock-checklist");
  for (const it of items) {
    const row = el("div", "unlock-check" + (it.done ? " done" : ""));
    row.append(
      el("span", "unlock-check-mark", it.done ? "✓" : "○"),
      el("span", "unlock-check-label", it.label + (it.note ? " · " + it.note : "")),
    );
    box.appendChild(row);
  }
  return box;
}
function progressBarEl(cur, max, label) {
  const wrap = el("div", "unlock-bar-wrap");
  wrap.appendChild(el("div", "unlock-bar-label", label + " · " + cur + "/" + max));
  const bar = el("div", "unlock-bar");
  const fill = el("div", "unlock-bar-fill");
  fill.style.width = Math.min(100, Math.round((cur / max) * 100)) + "%";
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}
// The rewards board: the two headline unlocks with live progress, so
// "how do I get Golden Satoshi" is answered on the hub, never a mystery.
function rewardsPanelEl() {
  const p = SAVE.progress;
  const total = SAVE.totalBalloons();
  const max = TRACKS.length * 3;
  const panel = el("div", "hub-rewards");
  panel.appendChild(el("h3", "hub-rewards-title", "REWARDS TO UNLOCK"));

  const sat = el("div", "hub-reward" + (p.satoshiUnlocked ? " got" : ""));
  sat.appendChild(el("div", "hub-reward-name", (p.satoshiUnlocked ? "✓ " : "🔒 ") + "Satoshi · the eleventh racer"));
  if (p.satoshiUnlocked) sat.appendChild(el("div", "hub-reward-done", COPY.adventure.satoshiUnlocked));
  else sat.appendChild(checklistEl(satoshiReqs()));
  panel.appendChild(sat);

  const gold = el("div", "hub-reward" + (p.goldenSatoshi ? " got gold" : ""));
  gold.appendChild(el("div", "hub-reward-name", (p.goldenSatoshi ? "★ " : "🔒 ") + "Golden Satoshi + Golden Island"));
  if (p.goldenSatoshi) gold.appendChild(el("div", "hub-reward-done", COPY.adventure.goldenSatoshiSub));
  else {
    gold.appendChild(progressBarEl(total, max, "Every Orange Balloon"));
    gold.appendChild(el("div", "hub-reward-hint", "1st place + a full sat stack on all " + TRACKS.length + " tracks and bosses."));
  }
  panel.appendChild(gold);
  return panel;
}

// ----- hub (adventure) -----
{
  screen("hub");
}
function renderHub() {
  goldify(); // gild + retro-grant before the atoll reads the flag
  atoll.setGolden(SAVE.progress.goldenSatoshi); // golden hour at 100%
  const s = screens.hub;
  s.textContent = "";
  const wrap = el("div", "hub-wrap");
  const head = el("div", "select-head");
  head.append(el("h2", "scr-title", COPY.adventure.hubName), button("← BACK", "small", () => go(() => { renderMenu(); show("menu"); })));
  wrap.appendChild(head);
  wrap.appendChild(el("div", "hub-balloons",
    "🎈 " + SAVE.totalBalloons() + " " + COPY.adventure.balloonLabel + " · 1st place: 2 · top three: 1 · full sat stack: +1"));

  const worldsRow = el("div", "hub-worlds");
  for (const w of WORLDS) {
    const card = el("div", "hub-world");
    card.dataset.world = w.id;
    const open = worldOpen(w.id);
    card.append(el("h3", "hub-world-name", w.name), el("p", "hub-world-tag", w.tag));
    if (!open) {
      card.append(el("p", "hub-lock", w.door + " sealed · " + SAVE.totalBalloons() + "/" + w.cost + " balloons"));
      card.classList.add("locked");
    }
    const list = el("div", "hub-events");
    for (const t of TRACKS.filter((x) => x.world === w.id)) {
      const st = eventState(t);
      const row = el("button", "hub-event" + (st.open ? "" : " locked") + (t.boss ? " boss" : ""));
      const earned = SAVE.progress.balloons[t.id] || 0;
      const clearedBoss = t.boss && SAVE.progress.bossBeaten[t.boss];
      // EVERY level shows its three balloon pips (top three · first place ·
      // full sat stack), cleared bosses included, so a completionist can
      // see which FINAL level still owes its full-stack balloon. Cleared
      // bosses used to hide the count behind a "CLEARED" badge, which is
      // exactly what stranded players chasing Golden Satoshi (fix 2026-07-19).
      const pips = "🎈".repeat(earned) + "○".repeat(Math.max(0, 3 - earned));
      const top = el("div", "hub-event-top");
      top.append(
        el("span", "hub-event-name", (clearedBoss ? "✓ " : t.boss ? "⚔ " : "") + t.name),
        el("span", "hub-event-balloons" + (earned === 3 ? " full" : clearedBoss ? " cleared" : ""), pips),
      );
      row.appendChild(top);
      if (!st.open) row.appendChild(el("span", "hub-event-req", "🔒 " + st.reason));
      else if (earned < 3) {
        row.appendChild(el("span", "hub-event-req open",
          earned < 2 ? "Finish top 3 for a balloon" : "Win with a full sat stack for the last balloon"));
      }
      if (!st.open) row.title = st.reason;
      row.addEventListener("click", () => {
        if (!st.open) { Snd.sfx("wrong"); toastHub(st.reason); return; }
        Snd.sfx("click");
        startRace({ mode: "adventure", trackId: t.id });
      });
      list.appendChild(row);
    }
    card.appendChild(list);
    worldsRow.appendChild(card);
  }
  wrap.appendChild(worldsRow);

  // the rewards board makes both headline unlocks (Satoshi, Golden Satoshi
  // + Golden Island) and their live progress visible right on the hub
  wrap.appendChild(rewardsPanelEl());

  // THE GENESIS RUN · the finale card appears once Satoshi is unlocked
  if (SAVE.progress.satoshiUnlocked) {
    const fin = el("button", "hub-finale" + (SAVE.progress.genesisRun ? " done" : ""));
    fin.append(
      el("span", "hub-finale-title", "🌅 " + COPY.finale.hubTitle),
      el("span", "hub-finale-sub", SAVE.progress.genesisRun ? COPY.finale.hubDone : COPY.finale.hubOpen),
    );
    fin.addEventListener("click", () => { unlockAudio(); Snd.sfx("click"); renderFinaleIntro(); });
    wrap.appendChild(fin);
  }
  const hubToast = el("div", "hub-toast");
  hubToast.id = "hub-toast";
  wrap.appendChild(hubToast);
  s.appendChild(wrap);

  // the Genesis Runner parks by the throne once the signal is recovered
  // (goldify above means the palette is already gilded at 100%)
  const sat = ROSTER.find((d) => d.id === "satoshi");
  atoll.parkSatoshi(SAVE.progress.satoshiUnlocked && sat ? sat.palette : null);

  // balloon ceremony: fresh balloons pop a burst train over their world's
  // gate the moment the atoll is back on screen
  if (pendingBalloonParty) {
    atoll.celebrate(pendingBalloonParty);
    pendingBalloonParty = null;
  }

  // story reels · at most one per hub visit, priority: arrival, then the
  // signal recovery, then golden hour, then gate openings. Reduced-motion
  // players get the beat as a toast instead of a camera move; either way
  // it fires once and the seen flag rides the cloud.
  requestAnimationFrame(() => {
    if (state !== "hub" || document.querySelector(".cine-overlay")) return;
    const story = COPY.story;
    const beat = !storySeen("hubArrival") ? { id: "hubArrival", kind: "arrival", cards: story.hubArrival.cards, world: null }
      : SAVE.progress.satoshiUnlocked && !storySeen("satoshiSignal") ? { id: "satoshiSignal", kind: "signal", cards: story.satoshiUnlock.cards, world: null }
        : SAVE.progress.goldenSatoshi && !storySeen("goldenHour") ? { id: "goldenHour", kind: "golden", cards: story.goldenHour.cards, world: null }
          : worldOpen("corporate") && !storySeen("gate:corporate") ? { id: "gate:corporate", kind: "gate", cards: story.gates.corporate.cards, world: "corporate" }
            : worldOpen("neon") && !storySeen("gate:neon") ? { id: "gate:neon", kind: "gate", cards: story.gates.neon.cards, world: "neon" }
              : null;
    if (!beat) return;
    markStorySeen(beat.id);
    if (reduceMotion()) {
      const last = beat.cards[beat.cards.length - 1];
      toastHub((last.title ? last.title + " · " : "") + (last.line || ""));
      return;
    }
    playHubCine(beat.kind, beat.cards, beat.world, null);
  });
}
function toastHub(text) {
  const t = document.getElementById("hub-toast");
  if (!t) return;
  t.textContent = text;
  t.dataset.on = "1";
  setTimeout(() => { t.dataset.on = "0"; }, 2400);
}

// ----- codex -----
{
  screen("codex");
}
function renderCodex() {
  const s = screens.codex;
  s.textContent = "";
  const wrap = el("div", "codex-wrap");
  const head = el("div", "select-head");
  head.append(el("h2", "scr-title", "SHELF · CODEX"), button("← BACK", "small", () => go(() => { renderMenu(); show("menu"); })));
  wrap.appendChild(head);

  // ---- trophy shelf · cups + challenge badges (Tier 1 2026-07-14) ----
  const shelf = el("div", "shelf");
  shelf.appendChild(el("div", "shelf-title", "TROPHY SHELF"));
  const cupsRow = el("div", "shelf-cups");
  for (const cup of CUPS) {
    const r = SAVE.progress.cups[cup.id];
    const medal = r === 1 ? "🏆" : r === 2 ? "🥈" : r === 3 ? "🥉" : "○";
    const c = el("div", "shelf-cup" + (r ? "" : " locked"));
    c.append(el("span", "shelf-cup-medal", medal), el("span", "shelf-cup-name", cup.name));
    cupsRow.appendChild(c);
  }
  shelf.appendChild(cupsRow);
  const done = CHALLENGES.filter((c) => SAVE.progress.challenges[c.id]).length;
  shelf.appendChild(el("div", "shelf-title challenges", "CHALLENGES · " + done + "/" + CHALLENGES.length));
  const chList = el("div", "shelf-challenges");
  for (const ch of CHALLENGES) {
    const got = !!SAVE.progress.challenges[ch.id];
    const row = el("div", "shelf-challenge" + (got ? "" : " locked"));
    row.append(
      el("span", "shelf-ch-mark", got ? "✓" : "○"),
      el("span", "shelf-ch-title", ch.title),
      el("span", "shelf-ch-desc", ch.desc),
    );
    chList.appendChild(row);
  }
  shelf.appendChild(chList);
  wrap.appendChild(shelf);

  wrap.appendChild(el("p", "codex-sub", "Rule Tokens recovered on the Orange Circuit. Finish top three on an event to claim its rule."));
  const list = el("div", "codex-list");
  for (const rule of CODEX) {
    const got = SAVE.progress.codex.includes(rule.id);
    const row = el("div", "codex-rule" + (got ? "" : " locked"));
    row.append(
      el("span", "codex-num", String(rule.id).padStart(2, "0")),
      el("span", "codex-title", got ? rule.title : "???"),
      el("span", "codex-body", got ? rule.body : "Recovered on " + trackById(rule.event).name + "."),
    );
    list.appendChild(row);
  }
  wrap.appendChild(list);
  s.appendChild(wrap);
}

// ----- results -----
{
  screen("results");
}
function renderResults(data) {
  const s = screens.results;
  s.textContent = "";
  // corrupt / incomplete finish payloads must never white-screen the cabinet
  const t = raceCtx && trackById(raceCtx.trackId);
  const playerRow = data && Array.isArray(data.results) && data.results.find((r) => r.isPlayer);
  if (!t || !playerRow) {
    renderMenu();
    show("menu");
    return;
  }
  const wrap = el("div", "results-wrap");
  const rank = playerRow.rank;

  let headline;
  if (raceCtx.mode === "daily") headline = "DAILY CIRCUIT #" + raceCtx.day + " · " + fmtTime(data.timeMs);
  else if (raceCtx.mode === "tt") headline = fmtTime(data.timeMs) + (data.newPb ? " · NEW PB" : "");
  else if (rank === 1) headline = COPY.results.win;
  else if (rank <= 3) headline = COPY.results.podium;
  else if (rank <= 5) headline = COPY.results.mid;
  else headline = COPY.results.back;

  // your driver's face wears the result (podium emotions 2026-07-16):
  // grin on a win, despair at the back · satoshi has no textured face
  if (selectedDriver !== "satoshi" && raceCtx.mode !== "tt") {
    const mood = rank === 1 ? "grin" : rank <= 3 ? null : rank >= 6 ? "sad" : null;
    if (mood) {
      const chip = document.createElement("canvas");
      chip.className = "results-mood";
      chip.width = 88; chip.height = 88;
      const cctx = chip.getContext("2d");
      // crop the painted face window · rect owned by faces.js (FACE_CROP)
      cctx.drawImage(paintFace(selectedDriver, mood), FACE_CROP.x, FACE_CROP.y, FACE_CROP.w, FACE_CROP.h, 0, 0, chip.width, chip.height);
      wrap.appendChild(chip);
    }
  }
  wrap.appendChild(el("h2", "results-headline" + (rank === 1 ? " gold" : ""), headline));
  wrap.appendChild(el("p", "results-track", t.name + " · " + (WORLDS.find((w) => w.id === t.world) || {}).name));

  const table = el("div", "results-table");
  for (const r of data.results) {
    const row = el("div", "results-row" + (r.isPlayer ? " me" : ""));
    row.append(
      el("span", "results-rank", String(r.rank)),
      el("span", "results-name", r.driver.displayName + (r.isPlayer ? " · YOU" : "")),
      el("span", "results-team " + (r.driver.side || ""), r.driver.side === "fiat" ? "FIAT" : "BTC"),
      // projected finishers never crossed the line · no fabricated time (M3)
      el("span", "results-time", r.projected ? "···" : fmtTime(Math.round(r.time * 1000))),
    );
    if (raceCtx.cupState) {
      row.appendChild(el("span", "results-pts", "+" + (CUP_POINTS[r.rank - 1] || 0) + " · " + (raceCtx.cupState.points[r.driver.id] || 0) + " pts"));
    }
    table.appendChild(row);
  }
  wrap.appendChild(table);
  // team scoreline: which side owned the top half of the grid
  if (data.results.length >= 6) {
    const top = data.results.slice(0, 4);
    const btcN = top.filter((r) => r.driver.side === "btc").length;
    wrap.appendChild(el("p", "results-teamline",
      COPY.teams.btc + " " + btcN + " · " + (4 - btcN) + " " + COPY.teams.fiat + " in the top four"));
  }

  if (data.awards && data.awards.length) {
    const aw = el("div", "results-awards");
    // a real unlock (a new racer / world / the golden reward / a boss down)
    // gets a celebratory card, not just another mono line, so "you unlocked
    // something" always lands (unlock-clarity pass 2026-07-19)
    for (const a of data.awards) aw.appendChild(el("div", "results-award" + (isUnlockAward(a) ? " unlock" : ""), a));
    wrap.appendChild(aw);
  }

  // challenge next-up strip: the results screen is peak engagement ·
  // point the next race at a purpose (first shelf slot still empty)
  {
    const done = CHALLENGES.filter((c) => SAVE.progress.challenges[c.id]).length;
    const strip = el("div", "results-challenges");
    strip.appendChild(el("span", "results-ch-count",
      COPY.results.challengeLabel + " · " + done + "/" + CHALLENGES.length));
    if (done >= CHALLENGES.length) {
      strip.appendChild(el("span", "results-ch-next", COPY.results.challengeDone));
    } else {
      const next = CHALLENGES.find((c) => !SAVE.progress.challenges[c.id]);
      strip.appendChild(el("span", "results-ch-next",
        COPY.results.challengeNext + " · " + next.title + " · " + next.desc));
    }
    wrap.appendChild(strip);
  }

  // today's shared board (daily mode) · renders immediately, the async
  // continuation patches real rows in when the network answers
  if (raceCtx.mode === "daily") {
    const bd = el("div", "daily-board");
    bd.appendChild(el("div", "daily-board-title", "TODAY'S BOARD · everyone raced this exact circuit"));
    if (data.board && data.board.length) {
      fillDailyBoard(bd, data.board);
      // gap to crown (social board 2026-07-17): the same target the menu
      // panel shows · ties this screen to tomorrow's comeback
      const crownMs = KART_BASE_MS - data.board[0].score;
      if (data.timeMs > crownMs + 50) {
        bd.appendChild(el("div", "daily-board-row wait", ((data.timeMs - crownMs) / 1000).toFixed(1) + "s " + COPY.menuBoard.crownGap));
      }
    } else if (data.boardPending) bd.appendChild(el("div", "daily-board-row wait", "syncing with the global board…"));
    else bd.appendChild(el("div", "daily-board-row wait", "not posted · over the daily window"));
    wrap.appendChild(bd);

    // next-drop countdown: the results screen is peak engagement · point
    // it at tomorrow's appointment. Re-derives the live day each tick so
    // a screen left open (or a race finishing) across UTC midnight flips
    // to "is open" instead of freezing at 00:00:00 (review 2026-07-14).
    const cd = el("div", "daily-next", "");
    const nextDay = raceCtx.day + 1;
    const nextAt = (Math.floor(Date.now() / 86400000) + 1) * 86400000;
    const tickCd = () => {
      if (!cd.isConnected) { clearInterval(cdId); return; }
      if (kartDayNumber(Date.now()) > raceCtx.day) {
        cd.textContent = "CIRCUIT #" + nextDay + " is open now · take it from the menu";
        clearInterval(cdId);
        return;
      }
      const ms = Math.max(0, nextAt - Date.now());
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
      cd.textContent = "CIRCUIT #" + nextDay + " drops in " +
        String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
    };
    const cdId = screenInterval(tickCd, 1000, "results");
    tickCd();
    wrap.appendChild(cd);

    // cross-cabinet funnel: whichever sitewide dailies are still open
    // (same hand-synced LS keys the site's DailyLoop reads). Uses the
    // LIVE day, not raceCtx.day · a post-midnight finish must not
    // advertise yesterday's closed dailies.
    const openOnes = [];
    try {
      const n = kartDayNumber(Date.now());
      if (!localStorage.getItem("gm:wen:res:" + n)) openOnes.push(["WEN #" + n, "/wen"]);
      if (!localStorage.getItem("gm:g2:res:" + n)) openOnes.push(["Gauntlet #" + n, "/gauntlet"]);
      const sraw = localStorage.getItem("gm:super-saylor:summit");
      let sDone = false;
      if (sraw) { const sp = JSON.parse(sraw); sDone = !!sp && sp.day === n; }
      if (!sDone) openOnes.push(["Daily Summit #" + n, "/super-saylor"]);
    } catch { /* private mode · skip the funnel */ }
    if (openOnes.length) {
      const fu = el("div", "daily-funnel");
      fu.appendChild(el("span", "daily-funnel-label", "STILL OPEN TODAY"));
      for (const [label, href] of openOnes) {
        const a = el("a", "daily-funnel-link", label + " →");
        a.href = href;
        fu.appendChild(a);
      }
      wrap.appendChild(fu);
    }
  }

  const btns = el("div", "results-btns");
  // share · shareBuild(ghostId|null) builds the tweet so the SAME line
  // can be re-rendered with the ~g dare id once the mint answers
  let shareBuild = null;
  if (raceCtx.mode === "daily") {
    // rank rides along when the board continuation already reported one
    // (a re-render after the patch); on the first paint it's simply absent
    shareBuild = (gid) => dailyShareText(data, gid);
  } else if (raceCtx.mode === "adventure" && t.boss === "schiff" && rank === 1) {
    shareBuild = () => COPY.shareLines.beatSchiff.replace("{driver}", driverName(selectedDriver));
  } else if (data.satoshiJustUnlocked) {
    shareBuild = () => COPY.shareLines.satoshi;
  } else if (raceCtx.mode === "challenge") {
    const line = data.timeMs < raceCtx.dare.t ? COPY.shareLines.dareWin : COPY.shareLines.dareLost;
    shareBuild = (gid) => line
      .replace("{name}", raceCtx.dare.name)
      .replace("{track}", t.name)
      .replace("{time}", fmtTime(data.timeMs))
      .replace("{url}", cardUrl({
        trackId: t.id,
        driverId: selectedDriver,
        timeMs: data.timeMs,
        klass: raceCtx.klass,
        mirror: raceCtx.mirror,
        ghostId: gid || null,
      }));
  } else if (raceCtx.mode === "tt") {
    shareBuild = (gid) => COPY.shareLines.timeTrial
      .replace("{track}", t.name)
      .replace("{time}", fmtTime(data.timeMs))
      .replace("{url}", cardUrl({
        trackId: t.id,
        driverId: selectedDriver,
        timeMs: data.timeMs,
        klass: raceCtx.klass,
        mirror: raceCtx.mirror,
        ghostId: gid || null,
      }));
  } else {
    // EVERY grid finisher shares (share-funnel audit 2026-07-26 · was
    // rank <= 3, which silently excluded P4-P8, i.e. most new players).
    // P1/P2/P3 keep their lines; the field gets the avenge-my-ghost
    // dare, which is the better chain economics anyway.
    const line = rank === 1 ? COPY.shareLines.win
      : rank === 2 ? COPY.shareLines.almost
        : rank === 3 ? COPY.shareLines.podium
          : COPY.shareLines.field;
    shareBuild = (gid) => line
      .replace("{rank}", String(rank))
      .replace("{track}", t.name)
      .replace("{driver}", driverName(selectedDriver))
      .replace("{url}", cardUrl({
        trackId: t.id,
        driverId: selectedDriver,
        timeMs: data.timeMs,
        rank,
        klass: raceCtx.klass,
        mirror: raceCtx.mirror,
        ghostId: gid || null,
      }));
  }
  if (shareBuild) {
    const a = el("a", "btn share", "SHARE ON X →");
    a.href = shareIntent(shareBuild(null));
    a.target = "_blank";
    a.rel = "noopener";
    wireDareShare(a, shareBuild, data);
    btns.appendChild(a);
    // native-media companion: the live podium frame as a PNG · the
    // share sheet / clipboard path beats a link card in the timeline
    const ph = button("📸 PHOTO", "", () => {
      sharePhoto({
        left: t.name.toUpperCase() + " · " +
          (raceCtx.mode === "tt" || raceCtx.mode === "challenge" || raceCtx.mode === "daily"
            ? fmtTime(data.timeMs)
            : "P" + rank + " · " + driverName(selectedDriver).toUpperCase()),
        text: shareBuild(null),
      }, ph);
    });
    btns.appendChild(ph);
  }
  // the unlock moment points straight at the finale (story beat 2026-07-17)
  if (data.satoshiJustUnlocked) {
    btns.appendChild(button("🌅 " + COPY.finale.hubTitle + " →", "primary", () => renderFinaleIntro()));
  }
  // 100% reward: send the player to the showroom to meet Golden Satoshi.
  // Suppressed when Satoshi ALSO just unlocked this race (the boss-last
  // completionist): the Genesis Run button takes that slot so the story
  // stays first · the gold materializes when they next open the hub/select
  if (data.goldenJustUnlocked && !data.satoshiJustUnlocked) {
    btns.appendChild(button("★ MEET GOLDEN SATOSHI →", "primary", () => go(() => {
      goldify(); // gild before the showroom reads the palette
      selectedDriver = "satoshi";
      showroom.setDriver("satoshi", ROSTER.find((d) => d.id === "satoshi").palette);
      pendingAfterSelect = "menu";
      renderSelect();
      show("select");
    })));
  }

  if (raceCtx.cupState) {
    const cs = raceCtx.cupState;
    if (cs.raceIdx < cs.cup.events.length - 1) {
      btns.appendChild(button("NEXT RACE →", "primary", () => {
        cs.raceIdx++;
        startRace({ mode: "gp", trackId: cs.cup.events[cs.raceIdx], cupState: cs });
      }));
    } else {
      btns.appendChild(button("TROPHY CEREMONY →", "primary", () => go(() => renderTrophy(cs))));
    }
  } else if (raceCtx.mode === "daily") {
    // label from the LIVE day: startDaily() recomputes the day at click
    // time, so after UTC midnight this is a fresh circuit with no ghost
    const hasGhost = !!loadDailyGhost(kartDayNumber(Date.now()));
    btns.appendChild(button(hasGhost ? "RACE YOUR GHOST" : "RACE IT AGAIN", "primary", () => startDaily()));
  } else if (raceCtx.mode === "adventure") {
    btns.appendChild(button("BACK TO THE ATOLL →", "primary", () => go(() => { renderHub(); show("hub"); })));
    // one-more-race is never more than one tap away: RETRY after a miss,
    // RACE AGAIN even when you podium (chasing balloons or challenges)
    if (rank > (t.boss ? 1 : 3)) btns.appendChild(button("RETRY", "", () => startRace({ mode: "adventure", trackId: t.id })));
    else btns.appendChild(button("RACE AGAIN", "", () => startRace({ mode: "adventure", trackId: t.id })));
  } else if (raceCtx.mode === "finale") {
    // only defeat reaches this screen · victory rolled the credits
    btns.appendChild(button(COPY.finale.retry, "primary", () => startFinale()));
    btns.appendChild(button(COPY.finale.toAtoll, "", () => go(() => { renderHub(); show("hub"); })));
  } else if (raceCtx.mode === "challenge") {
    // dare rematch keeps the SAME ghost on track (frames ride raceCtx)
    const d = raceCtx.dare;
    btns.appendChild(button(data.timeMs < d.t ? "RUN IT BACK" : "HUNT IT AGAIN", "primary",
      () => startChallenge({ trackId: raceCtx.trackId, klass: raceCtx.klass, mirror: raceCtx.mirror, t: d.t, name: d.name, frames: d.frames }, d.id)));
    btns.appendChild(button("TODAY'S CIRCUIT →", "", () => startDaily()));
  } else {
    btns.appendChild(button("REMATCH", "primary", () => startRace({ mode: raceCtx.mode, trackId: t.id })));
    btns.appendChild(button("CHANGE TRACK", "", () => go(() => { renderTracks(raceCtx.mode); show("tracks"); })));
  }
  btns.appendChild(button("MENU", "", () => go(() => { renderMenu(); show("menu"); })));
  wrap.appendChild(btns);
  // optional X identity · one affordance on EVERY results screen (not
  // just daily) so the same screen that shows SHARE ON X also offers to
  // claim your real handle. Gated on the sitewide feature being live +
  // still anonymous. Reads the boot-probe flags directly (they have long
  // resolved by any results screen, so no timing guard needed).
  if (xLinkEnabled && !xLinkedName) {
    const xr = el("div", "menu-xlink results-xlink");
    const xa = el("a", "menu-xlink-cta", "🔗 LINK X · post scores under your real @handle →");
    xa.href = "/api/auth/x/start?return=" + encodeURIComponent("/bitcoin-kart");
    xr.appendChild(xa);
    wrap.appendChild(xr);
  } else if (xLinkedName) {
    wrap.appendChild(el("div", "menu-xlink results-xlink menu-xlink-on", "posting as " + xLinkedName + " ✓"));
  }
  // challenge excluded: its verdict line is the dare win/lose copy ·
  // stacking the DNF quip under it read as the game dunking twice
  if (rank > 3 && raceCtx.mode !== "tt" && raceCtx.mode !== "challenge") wrap.appendChild(el("p", "results-dnf", COPY.dnf));
  // ONE quiet site link · the deepest-engagement moment on the site's
  // most-played cabinet was a dead end back to itself. Plain anchor,
  // so the kart's static no-inline CSP is untouched. Keep it to one
  // link; this screen is deliberately curated.
  const siteRow = el("div", "menu-xlink results-xlink");
  const siteA = el("a", "menu-xlink-cta", "MORE BITCOIN GAMES · THE ARCADE →");
  siteA.href = "/arcade";
  siteRow.appendChild(siteA);
  wrap.appendChild(siteRow);
  maybeShowInstallCard(wrap);
  s.appendChild(wrap);
}

function renderTrophy(cs) {
  const s = screens.results;
  s.textContent = "";
  const wrap = el("div", "results-wrap");
  const standings = Object.entries(cs.points).sort((a, b) => b[1] - a[1]);
  const myIdx = standings.findIndex(([id]) => id === selectedDriver);
  const myRank = myIdx + 1;
  // trophy shelf persistence · best podium rank per cup (1..3)
  if (myRank <= 3 && myRank < (SAVE.progress.cups[cs.cup.id] || 99)) {
    SAVE.progress.cups[cs.cup.id] = myRank;
    SAVE.persistProgress();
  }
  wrap.appendChild(el("h2", "results-headline" + (myRank === 1 ? " gold" : ""),
    myRank === 1 ? "🏆 " + cs.cup.name.toUpperCase() + " CHAMPION" : cs.cup.name.toUpperCase() + " · P" + myRank));
  if (myRank === 1) wrap.appendChild(el("p", "results-track", COPY.victory[Math.floor(Math.random() * COPY.victory.length)]));
  const table = el("div", "results-table");
  standings.forEach(([id, pts], i) => {
    const row = el("div", "results-row" + (id === selectedDriver ? " me" : ""));
    row.append(
      el("span", "results-rank", String(i + 1)),
      el("span", "results-name", driverName(id) + (id === selectedDriver ? " · YOU" : "")),
      el("span", "results-time", pts + " pts"),
    );
    table.appendChild(row);
  });
  wrap.appendChild(table);
  if (myRank <= 3) {
    const prev = SAVE.progress.cups[cs.cup.id] || 9;
    if (myRank < prev) { SAVE.progress.cups[cs.cup.id] = myRank; SAVE.persistProgress(); queueCloudPush(); }
  }
  const btns = el("div", "results-btns");
  if (myRank === 1) {
    const a = el("a", "btn share", "SHARE ON X →");
    a.href = shareIntent(COPY.shareLines.cup.replace("{cup}", cs.cup.name).replace("{driver}", driverName(selectedDriver)));
    a.target = "_blank";
    a.rel = "noopener";
    btns.appendChild(a);
  }
  btns.appendChild(button("MENU", "primary", () => go(() => { renderMenu(); show("menu"); })));
  wrap.appendChild(btns);
  s.appendChild(wrap);
  if (audioReady) Snd.playTheme(myRank === 1 ? "victory" : "results");
  show("results");
}

function fmtTime(ms) {
  const m = Math.floor(ms / 60000);
  const s2 = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return m + ":" + String(s2).padStart(2, "0") + "." + d;
}

// ----- settings + pause overlays -----
const overlayRoot = el("div", "overlay");
overlayRoot.id = "overlay";
uiRoot.appendChild(overlayRoot);

function openSettings() {
  overlay = "settings";
  overlayRoot.textContent = "";
  overlayRoot.dataset.on = "1";
  const box = el("div", "overlay-box");
  box.appendChild(el("h3", "overlay-title", "SETTINGS"));
  const mk = (label, val, fn) => {
    const row = el("div", "set-row");
    row.appendChild(el("span", "set-label", label));
    const input = el("input");
    input.type = "range";
    input.min = "0"; input.max = "1"; input.step = "0.05";
    input.value = String(val);
    input.addEventListener("input", () => fn(parseFloat(input.value)));
    row.appendChild(input);
    return row;
  };
  // each audio row: volume slider + an ON/OFF toggle that mirrors the
  // persistent marquee toggle (single source of truth: musicOn / sfxOn)
  const audRow = (label, volKey, onKey) => {
    const row = mk(label, SAVE.settings[volKey], (v) => { SAVE.settings[volKey] = v; Snd.applyVolumes(); SAVE.persistSettings(); });
    const off = SAVE.settings[onKey] === false;
    row.appendChild(button(off ? "OFF" : "ON", "small" + (off ? "" : " sel"), () => {
      SAVE.settings[onKey] = SAVE.settings[onKey] === false;
      Snd.applyVolumes();
      SAVE.persistSettings();
      paintAudioToggles();
      openSettings();
    }));
    return row;
  };
  box.appendChild(audRow("MUSIC", "music", "musicOn"));
  box.appendChild(audRow("SFX", "sfx", "sfxOn"));

  const qRow = el("div", "set-row");
  qRow.appendChild(el("span", "set-label", "QUALITY"));
  for (const q of ["auto", "high", "medium", "low"]) {
    const b = button(q.toUpperCase(), "small" + (SAVE.settings.quality === q ? " sel" : ""), () => {
      SAVE.settings.quality = q;
      SAVE.persistSettings();
      applyQuality();
      openSettings();
    });
    qRow.appendChild(b);
  }
  box.appendChild(qRow);

  const fxRow = el("div", "set-row");
  fxRow.appendChild(el("span", "set-label", "REDUCED MOTION"));
  const fxBtn = button(SAVE.settings.reduceFx ? "ON" : "OFF", "small", () => {
    SAVE.settings.reduceFx = !SAVE.settings.reduceFx;
    fxBtn.textContent = SAVE.settings.reduceFx ? "ON" : "OFF";
    SAVE.persistSettings();
    // re-apply live: flip the post pipeline + the CSS reduced-motion flag
    // now instead of waiting for the next reload
    applyQuality();
  });
  fxRow.appendChild(fxBtn);
  box.appendChild(fxRow);

  const diffRow = el("div", "set-row");
  diffRow.appendChild(el("span", "set-label", "DIFFICULTY"));
  for (const d of ["auto", "relaxed", "standard"]) {
    diffRow.appendChild(button(d.toUpperCase(), "small" + ((SAVE.settings.difficulty || "auto") === d ? " sel" : ""), () => {
      SAVE.settings.difficulty = d;
      SAVE.persistSettings();
      openSettings();
    }));
  }
  box.appendChild(diffRow);

  const coachRow = el("div", "set-row");
  coachRow.appendChild(el("span", "set-label", "COACH TIPS"));
  const coachBtn = button(SAVE.settings.coachTips ? "ON" : "OFF", "small", () => {
    SAVE.settings.coachTips = !SAVE.settings.coachTips;
    coachBtn.textContent = SAVE.settings.coachTips ? "ON" : "OFF";
    SAVE.persistSettings();
  });
  coachRow.appendChild(coachBtn);
  box.appendChild(coachRow);

  // touch-only rows (Super Saylor lesson: control style is a preference)
  if (touch.enabled) {
    const steerRow = el("div", "set-row");
    steerRow.appendChild(el("span", "set-label", "STEERING"));
    for (const stl of ["joystick", "slider"]) {
      steerRow.appendChild(button(stl.toUpperCase(), "small" + (SAVE.settings.touchStyle === stl ? " sel" : ""), () => {
        SAVE.settings.touchStyle = stl;
        SAVE.persistSettings();
        buildTouch();
        openSettings();
      }));
    }
    box.appendChild(steerRow);

    const agRow = el("div", "set-row");
    agRow.appendChild(el("span", "set-label", "AUTO GAS"));
    const agBtn = button(SAVE.settings.autoAccel ? "ON" : "OFF", "small", () => {
      SAVE.settings.autoAccel = !SAVE.settings.autoAccel;
      agBtn.textContent = SAVE.settings.autoAccel ? "ON" : "OFF";
      SAVE.persistSettings();
      buildTouch();
    });
    agRow.appendChild(agBtn);
    box.appendChild(agRow);

    const hpRow = el("div", "set-row");
    hpRow.appendChild(el("span", "set-label", "HAPTICS"));
    const hpBtn = button(SAVE.settings.haptics ? "ON" : "OFF", "small", () => {
      SAVE.settings.haptics = !SAVE.settings.haptics;
      hpBtn.textContent = SAVE.settings.haptics ? "ON" : "OFF";
      SAVE.persistSettings();
    });
    hpRow.appendChild(hpBtn);
    box.appendChild(hpRow);
  }

  // settings opened from the pause menu goes BACK to pause, never to a
  // silently-resumed race (H3 · the sim stays frozen either way)
  const fromPause = state === "race" && racePaused;
  box.appendChild(button(fromPause ? "← BACK TO PAUSE" : "CLOSE", "primary", () => {
    if (state === "race" && racePaused) renderPauseBox();
    else closeOverlay();
  }));
  overlayRoot.appendChild(box);
}

// Pause is a dedicated flag, NOT "overlay === 'pause'" (bug 2026-07-14 ·
// opening Settings from the pause menu replaced the overlay string and
// silently UNFROZE the race under the modal). racePaused only clears on
// Resume / Restart / Quit · never by swapping overlays.
function togglePause() {
  if (state !== "race") return;
  if (overlay === "pause") { resumeRace(); return; }
  racePaused = true;
  Snd.suspend();
  renderPauseBox();
}

function renderPauseBox() {
  overlay = "pause";
  overlayRoot.textContent = "";
  overlayRoot.dataset.on = "1";
  const box = el("div", "overlay-box");
  box.appendChild(el("h3", "overlay-title", "PAUSED"));
  box.appendChild(button("RESUME", "primary", () => resumeRace()));
  // restart/quit ride the wipe with resumeRace INSIDE the cover: the
  // paused frame stays frozen until the slab owns the screen (an instant
  // resume would visibly un-pause the race for the cover-in beat)
  box.appendChild(button("RESTART RACE", "", () => go(() => { resumeRace(); startRace({ ...raceCtx }); })));
  box.appendChild(button("SETTINGS", "", () => openSettings()));
  box.appendChild(button("QUIT TO MENU", "", () => go(() => { resumeRace(); endRace(); renderMenu(); show("menu"); })));
  overlayRoot.appendChild(box);
}

function resumeRace() {
  racePaused = false;
  closeOverlay();
}

function closeOverlay() {
  const wasPause = overlay === "pause";
  overlay = null;
  overlayRoot.dataset.on = "0";
  overlayRoot.textContent = "";
  // audio follows the PAUSE state, not the overlay: closing settings
  // while still race-paused keeps the world silent until RESUME
  if (wasPause && !racePaused) Snd.resume();
  if (state === "race" && !wasPause && !racePaused && race) Snd.resume();
}

// ---------- race lifecycle ----------
function startCup(cup) {
  const cupState = { cup, raceIdx: 0, points: {} };
  startRace({ mode: "gp", trackId: cup.events[0], cupState });
}

function startDaily() {
  // whole body under one cover: the nested startRace runs synchronously,
  // so `race` below is the fresh daily race, never a stale handle
  go(() => {
    const day = kartDayNumber(Date.now());
    const combo = dailyCombo(day);
    startRace({ mode: "daily", trackId: combo.trackId, klass: combo.klass, mirror: combo.mirror, day });
    // world-leader ghost: fetched in parallel with the intro flyby and
    // injected into the running race (guarded: same race, still daily).
    // Your own leading run never doubles up with your local ghost.
    const myRace = race;
    void fetchLeaderGhost(day).then((g) => {
      if (!g || race !== myRace || !race || state !== "race") return;
      if (g.name === (xLinkedName || getHandle())) return; // that ghost IS your local one
      race.setRivalGhost(g);
    });
  });
}

// THE GENESIS RUN · story finale (2026-07-17): once Satoshi is unlocked,
// the hub offers one more race · dawn over Genesis Circuit, the player in
// the protocol's seat, every beaten rival back on the grid at once
// (bosses included). Victory sets progress.genesisRun and rolls credits.
function startFinale() {
  selectedDriver = "satoshi"; // the finale is raced AS the ghost of the protocol
  startRace({ mode: "finale", trackId: "genesis-circuit" });
}

function renderFinaleIntro() {
  const ov = el("div", "dare-intro finale-intro");
  const box = el("div", "dare-box");
  box.appendChild(el("div", "dare-label", "🌅 " + COPY.finale.hubTitle));
  for (const line of COPY.finale.intro) box.appendChild(el("p", "finale-line", line));
  const row = el("div", "results-btns");
  row.append(
    button(COPY.finale.start, "primary", () => { ov.remove(); startFinale(); }),
    button(COPY.finale.notYet, "", () => ov.remove()),
  );
  box.appendChild(row);
  ov.appendChild(box);
  document.body.appendChild(ov);
}

function renderCredits() {
  const ov = el("div", "credits");
  const roll = el("div", "credits-roll");
  roll.appendChild(el("h2", "credits-victory", COPY.finale.victory));
  for (const line of COPY.finale.credits) {
    if (line === "") roll.appendChild(el("div", "credits-gap"));
    else if (line === line.toUpperCase() && line.length <= 30) roll.appendChild(el("p", "credits-head", line));
    else roll.appendChild(el("p", "credits-line", line));
  }
  roll.appendChild(el("p", "credits-ng", COPY.finale.ngPlus));
  ov.appendChild(roll);
  const btns = el("div", "credits-btns");
  const share = el("a", "btn share", "SHARE ON X →");
  share.href = shareIntent(COPY.finale.share);
  share.target = "_blank";
  share.rel = "noopener";
  btns.append(
    button(COPY.finale.replay, "", () => { ov.remove(); startFinale(); }),
    share,
    button(COPY.finale.toAtoll, "primary", () => { ov.remove(); go(() => { renderHub(); show("hub"); }); }),
  );
  ov.appendChild(btns);
  document.body.appendChild(ov);
}

// dare challenge (?ghost=<id> deep link) · a solo race against a shared
// ghost line: the ghost's combo dictates track/class/mirror, its frames
// ride raceCtx so the rematch button can re-seat the same rival
function startChallenge(g, id) {
  // under one cover for the same reason as startDaily: the rival ghost
  // must seat on the race this call just created
  go(() => {
    startRace({
      mode: "challenge",
      trackId: g.trackId,
      klass: g.klass,
      mirror: g.mirror,
      dare: { id, t: g.t, name: g.name, frames: g.frames },
    });
    if (race) race.setRivalGhost({ t: g.t, name: g.name, frames: g.frames });
  });
}

// the landing interstitial a dare link opens on: who dares you, on what
// combo, one tap to race · MENU keeps the normal game a tap away
function renderDareIntro(g, id) {
  const t = trackById(g.trackId);
  if (!t) return;
  const ov = el("div", "dare-intro");
  const box = el("div", "dare-box");
  const klassName = (CLASSES[g.klass] || CLASSES.bits).name;
  box.append(
    el("div", "dare-label", COPY.dare.label),
    el("h2", "dare-title", g.name),
    el("p", "dare-line", t.name + " · " + klassName + (g.mirror ? " · MIRROR" : "") + " · " + fmtTime(g.t)),
    el("p", "dare-sub", COPY.dare.sub),
  );
  const row = el("div", "results-btns");
  row.append(
    button("RACE THE GHOST →", "primary", () => { ov.remove(); startChallenge(g, id); }),
    button("MENU", "", () => { ov.remove(); toMenu(); }),
  );
  box.appendChild(row);
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// Boss entrance reel: nameplate reveal pan, a tight stare-down with a
// spoken taunt, then a low hero swing around the player kart · runs over
// the live grid via race.js's cinema phase. Reduced-motion players go
// straight to the flyby (a camera reel IS motion).
function buildBossCinema(def) {
  if (reduceMotion()) return null;
  const b = driverById(def.boss);
  const me = ROSTER.find((d) => d.id === selectedDriver);
  if (!b || !me) return null;
  const story = (COPY.story.bosses || {})[def.boss] || {};
  const taunt = b.taunts && b.taunts.length ? b.taunts[Math.floor(Math.random() * b.taunts.length)] : "";
  return {
    seq: [
      { dur: 4.4, focus: "boss", a0: -0.55, a1: 0.4, r0: 7.5, r1: 4.6, h0: 1.1, h1: 1.8, ty: 1.15, fov: 44,
        card: { label: "BOSS RACE", title: b.displayName, line: b.kartName } },
      { dur: 3.4, focus: "boss", a0: 0.12, a1: -0.12, r0: 3.4, r1: 3.0, h0: 1.7, h1: 1.55, ty: 1.4, fov: 38, taunt,
        card: { label: story.title || "", line: story.pre || "" } },
      { dur: 3.0, focus: "player", a0: 2.6, a1: 3.4, r0: 5.2, r1: 4.3, h0: 0.9, h1: 1.4, ty: 1.2, fov: 46,
        card: { label: COPY.teams.btc + " vs " + COPY.teams.fiat, title: me.displayName, line: me.kartName } },
    ],
  };
}

// First race inside a world: one aerial chapter card over the course
// before the flyby (adventure mode only · quick racers skip straight in)
function buildChapterCinema(def) {
  if (reduceMotion()) return null;
  const w = (COPY.story.worlds || {})[def.world];
  const world = WORLDS.find((x) => x.id === def.world);
  if (!w || !world) return null;
  return {
    seq: [
      { dur: 4.6, fly: [0.1, 0.42, 11, 4], fov: 54,
        card: { label: w.chapter, title: world.name, line: w.line } },
    ],
  };
}

// THE GENESIS RUN · dawn ceremony reel: the empty track at first light,
// the seven-rival grid, then the ghost at the wheel (first run only)
function buildFinaleCinema() {
  if (reduceMotion()) return null;
  return {
    seq: [
      { dur: 4.6, fly: [0.55, 0.86, 13, 5], fov: 54,
        card: { label: COPY.finale.hubTitle, title: COPY.finale.trackName, line: COPY.finale.intro[0] } },
      { dur: 4.0, focus: "schiff", a0: -1.1, a1: 1.1, r0: 9.5, r1: 7.0, h0: 1.5, h1: 2.4, ty: 1.2, fov: 48,
        card: { line: COPY.finale.intro[1] } },
      { dur: 3.6, focus: "player", a0: 0.35, a1: -0.35, r0: 4.2, r1: 3.2, h0: 1.5, h1: 1.7, ty: 1.35, fov: 40,
        card: { label: "SATOSHI NAKAMOTO", line: COPY.finale.intro[2] } },
    ],
  };
}

// startRace rides the stage wipe at the function level so EVERY entry
// point (tracks grid, hub events, results rematches, pause restart, dare
// links) sweeps in, and the synchronous track build below happens at
// full cover instead of freezing a visible frame. Callers that read
// `race` right after must call startRace inside their own go() (nested
// calls run synchronously · see startDaily/startChallenge).
function startRace(ctx) { go(() => startRaceNow(ctx)); }
function startRaceNow(ctx) {
  endRace();
  // class + mirror: daily dictates its combo, adventure stays pure BITS,
  // everything else follows the persisted picker
  if (ctx.mode === "adventure" || ctx.mode === "finale") {
    ctx.klass = "bits";
    ctx.mirror = false;
  } else if (ctx.mode !== "daily") {
    ctx.klass = ctx.klass || SAVE.settings.raceClass || "bits";
    ctx.mirror = ctx.mirror !== undefined ? ctx.mirror : !!SAVE.settings.raceMirror;
  }
  raceCtx = ctx;
  let def = trackById(ctx.trackId);
  // a corrupt raceCtx / bad event id must never hard-crash the game (M7)
  if (!def) {
    renderMenu();
    show("menu");
    return;
  }
  if (ctx.mode === "finale") {
    // dawn ceremony over the same geometry: track.env rebuilds per race
    // while the mesh cache keys on id+mirror, so the sky override is
    // cache-safe (verified against buildTrack's vis bundle)
    def = { ...def, sky: "dawn", name: COPY.finale.trackName, laps: 3, intro: COPY.finale.intro[2], tip: "" };
  }
  let rivals, hard = false;
  if (ctx.mode === "tt") {
    rivals = []; // solo · pure time trial
  } else if (ctx.mode === "challenge") {
    // Dare links are the arcade's cold-visitor FRONT DOOR (share-funnel
    // audit 2026-07-26): solo-vs-ghost was the least spectacular
    // configuration the game could show a first-time player. Dares now
    // race a full grid · the ghost duel stays the verdict (your time vs
    // dare.t), the field is the spectacle. gentleAI below keeps the
    // race winnable for someone who has never touched the game.
    rivals = pickRivals(selectedDriver, 7);
  } else if (ctx.mode === "finale") {
    hard = true; // every beaten rival returns at once, bosses included
    rivals = ["schiff", "dimon", "warren", "buffett", "cuban", "bear2014", "headline"];
  } else if (def.boss) {
    hard = true;
    rivals = def.boss === "schiff"
      ? (selectedDriver === "schiff" ? ["saylor"] : ["schiff"])
      : [def.boss];
  } else {
    rivals = pickRivals(selectedDriver, 7);
  }
  const fairTt = ctx.mode === "tt" && ctx.klass === "bits" && !ctx.mirror;
  // ---- difficulty system (2026-07-22) ----
  // RELAXED = the gentle band in every non-boss race. AUTO (default) =
  // dynamic assist: recent finishes (device-local, like the coach's nag
  // counter · deliberately NOT cloud-synced) ease the field for a player
  // who keeps landing deep and step back once they climb; bosses BLINK
  // (lose the hard flag) after three straight losses on that track
  // (RELAXED: two). STANDARD = no assists, the purist opt-out.
  const diff = SAVE.settings.difficulty || "auto";
  let gentle = false, bossMercy = false;
  const aiRace = rivals && rivals.length > 0;
  if (aiRace && diff !== "standard") {
    if (def.boss || ctx.mode === "finale") {
      const losses = store.get("boss-losses:" + def.id, 0);
      if (losses >= (diff === "relaxed" ? 2 : 3)) { bossMercy = true; hard = false; }
    } else if (diff === "relaxed") {
      gentle = true;
    } else {
      // AUTO · hysteresis: ease at avg rank >= 5 over the last races,
      // release below 3.5 · in between keeps the previous state
      const ranks = store.get("assist-ranks", []);
      if (Array.isArray(ranks) && ranks.length >= 2) {
        const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
        const was = store.get("assist-on", false);
        gentle = avg >= 5 ? true : avg < 3.5 ? false : was;
        if (gentle !== was) store.set("assist-on", gentle);
      }
    }
  }
  // Dare visitors ALWAYS get the eased band, regardless of the local
  // difficulty setting · a cold visitor has no settings, no muscle
  // memory, and one shot at deciding whether this game is fun.
  if (ctx.mode === "challenge") gentle = true;
  const loadTip = COPY.tips[Math.floor(Math.random() * COPY.tips.length)];
  // pre-race story reels (each skippable · each fires once, storySeen
  // persists + cloud-merges): boss entrances beat world chapters; the
  // finale gets its own dawn ceremony
  let cinema = null;
  if (ctx.mode === "finale" && !storySeen("genesisReel")) {
    cinema = buildFinaleCinema();
    if (cinema) markStorySeen("genesisReel");
  } else if (def.boss && rivals.length === 1 && rivals[0] === def.boss && !storySeen("bossEnter:" + def.boss)) {
    cinema = buildBossCinema(def);
    if (cinema) markStorySeen("bossEnter:" + def.boss);
  } else if (ctx.mode === "adventure" && !storySeen("worldOpen:" + def.world)) {
    cinema = buildChapterCinema(def);
    if (cinema) markStorySeen("worldOpen:" + def.world);
  }

  race = createRace({
    R,
    def,
    playerId: selectedDriver,
    rivals,
    hard,
    mode: ctx.mode,
    hudRoot,
    reduceFx: SAVE.settings.reduceFx,
    klass: ctx.klass,
    mirror: ctx.mirror,
    ghost: fairTt ? loadGhost(def.id) : ctx.mode === "daily" ? loadDailyGhost(ctx.day) : null,
    gentle,
    buzz,
    cinema,
    holdIntro: () => !!document.querySelector(".touch-hint"),
    onFinish: (data) => finishRace(data),
  });
  enterRaceSession();
  maybeShowTouchHint();
  coach.start(race, {
    mode: ctx.mode,
    touch: touch.enabled,
    autoGas: touch.enabled && SAVE.settings.autoAccel,
    hudRoot,
  });
  window.__BK_RACE = race; // debug/verification handle (never surfaced in UI)
  // loading tip toast (+ honest assist chip when the difficulty system is
  // easing this race · silent rubber-banding is genre-standard, telling
  // the player is kinder)
  setTimeout(() => {
    if (state === "race" && race) {
      const hudToasts = hudRoot.querySelector(".hud-toasts");
      if (hudToasts) {
        const tEl = el("div", "hud-toast tip", loadTip);
        hudToasts.appendChild(tEl);
        setTimeout(() => tEl.remove(), 3500);
        if (bossMercy || (gentle && diff === "auto")) {
          const aEl = el("div", "hud-toast tip", bossMercy ? "THE BOSS BLINKS · mercy run (difficulty in settings)" : "THE FIELD EASES · dynamic assist (difficulty in settings)");
          hudToasts.appendChild(aEl);
          setTimeout(() => aEl.remove(), 4500);
        }
      }
    }
  }, 400);
  show("race");
}

async function finishRace(data) {
  // Guard: a missing track or player row used to throw and white-screen the
  // results path (audit 2026-07-19). Recover to the menu instead.
  const def = raceCtx && trackById(raceCtx.trackId);
  const playerRow = data && Array.isArray(data.results) && data.results.find((r) => r.isPlayer);
  if (!def || !playerRow) {
    endRace();
    renderMenu();
    show("menu");
    return;
  }
  const rank = playerRow.rank;
  const awards = [];
  let satoshiJustUnlocked = false;
  let goldenJustUnlocked = false;

  recordArcadeRun();

  // difficulty system bookkeeping (2026-07-22, device-local): AI races
  // feed the AUTO assist's rank window · boss tracks count consecutive
  // losses toward the mercy run and reset on a win
  if (raceCtx.mode !== "tt" && raceCtx.mode !== "challenge") {
    if (def.boss || raceCtx.mode === "finale") {
      const lk = "boss-losses:" + def.id;
      if (rank === 1) store.set(lk, 0);
      else store.set(lk, store.get(lk, 0) + 1);
    } else {
      const ranks = store.get("assist-ranks", []);
      ranks.push(rank);
      while (ranks.length > 4) ranks.shift();
      store.set("assist-ranks", ranks);
    }
  }

  // dare verdict · rides the awards strip (zero new UI surface)
  if (raceCtx.mode === "challenge" && raceCtx.dare) {
    const d = raceCtx.dare;
    awards.push(data.timeMs < d.t
      ? "DARE BEATEN · " + d.name + " ran " + fmtTime(d.t) + " · you ran " + fmtTime(data.timeMs)
      : "THE GHOST GOT AWAY · " + d.name + " ran " + fmtTime(d.t) + " · you ran " + fmtTime(data.timeMs));
  }

  // PB + ghost · only fair laps count (BITS class, no mirror)
  let newPb = false;
  if (raceCtx.mode === "tt" && raceCtx.klass === "bits" && !raceCtx.mirror) {
    const prev = SAVE.pbs[def.id];
    if (!prev || data.timeMs < prev) {
      SAVE.pbs[def.id] = data.timeMs;
      SAVE.persistPbs();
      newPb = true;
      if (data.ghost && data.ghost.length) saveGhost(def.id, data.ghost);
      awards.push("NEW PERSONAL BEST · ghost saved");
    }
  }

  // Daily Circuit: best time + ghost persist synchronously; the board
  // post/fetch runs AFTER the results screen is up (a stalled socket must
  // never hold the results hostage · was two serial awaits, made fully
  // non-blocking in the v1.5 loop pass; calls stay timeout-bounded and
  // the patch continuation is staleness-guarded).
  const KART_WINDOW_MS = KART_BASE_MS - KART_FLOOR_MS; // the server's honest envelope
  let dailyPending = false;
  let beatOwnGhost = false;
  if (raceCtx.mode === "daily") {
    const day = raceCtx.day;
    const bestKey = "daily-best:" + day;
    const prev = store.get(bestKey, null);
    if (!prev || data.timeMs < prev) {
      store.set(bestKey, data.timeMs);
      // today's best run becomes the ghost you race next attempt
      if (data.ghost && data.ghost.length) saveDailyGhost(day, data.ghost);
      if (prev) {
        awards.push("NEW DAILY BEST · your ghost just got faster");
        // GHOSTBUSTER honesty (M4): only counts when the ghost actually
        // raced alongside you this run
        beatOwnGhost = !!data.hadGhost;
      }
    }
    if (data.timeMs <= KART_WINDOW_MS) dailyPending = true;
    else awards.push("over the ten minute daily window · not posted");
  }

  // ---- challenges (data.js CHALLENGES · cosmetic shelf badges) ----
  {
    const drv = ROSTER.find((d) => d.id === selectedDriver);
    const won = rank === 1 && raceCtx.mode !== "tt";
    if (won) {
      if (!data.itemsUsed) awardChallenge("diamond-hands", awards);
      if (drv && drv.side === "fiat") awardChallenge("team-fiat", awards);
      if ((data.satsAtFinish || 0) >= 10) awardChallenge("full-stack", awards);
      if (def.boss === "schiff" && !data.usedChair) awardChallenge("no-chair", awards);
      // engagement pack (2026-07-21) · GHOST RIDER wants a real grid, so
      // solo dare rematches (mode "challenge") never count
      if (data.rocketStart) awardChallenge("rocket-start", awards);
      if (selectedDriver === "satoshi" && raceCtx.mode !== "challenge") awardChallenge("ghost-rider", awards);
      if (raceCtx.mirror && raceCtx.mode !== "challenge") awardChallenge("mirror-master", awards);
      if (raceCtx.klass === "fullsend" && raceCtx.mode !== "challenge") awardChallenge("full-send", awards);
    }
    if ((data.bigAirs || 0) >= 3) awardChallenge("moon-lander", awards);
    if (beatOwnGhost) awardChallenge("ghostbuster", awards);
  }

  if (raceCtx.mode === "adventure") {
    const isBoss = !!def.boss;
    const earned = balloonsForResult(rank, isBoss, (data.satsAtFinish || 0) >= 10);
    const prev = SAVE.progress.balloons[def.id] || 0;
    if (earned > prev) {
      SAVE.progress.balloons[def.id] = earned;
      awards.push("🎈 +" + (earned - prev) + " Orange Balloon" + (earned - prev > 1 ? "s" : ""));
      if (earned === 3) awards.push("FULL STACK WIN · the challenge balloon");
      Snd.sfx("balloon");
      pendingBalloonParty = def.world;
    }
    // NEW WORLD OPEN · a clear "you just unlocked something" beat the moment
    // a balloon threshold cracks a world gate (unlock-clarity pass 2026-07-19)
    {
      const delta = Math.max(0, earned - prev);
      const totalAfter = SAVE.totalBalloons();
      const totalBefore = totalAfter - delta;
      for (const w of WORLDS) {
        if (w.cost > 0 && totalBefore < w.cost && totalAfter >= w.cost) {
          awards.push("🔓 NEW WORLD OPEN · " + w.name);
          Snd.sfx("unlock");
        }
      }
    }
    const rule = CODEX.find((r) => r.event === def.id);
    if (rule && (rank <= 3 || (isBoss && rank === 1)) && !SAVE.progress.codex.includes(rule.id)) {
      SAVE.progress.codex.push(rule.id);
      awards.push(COPY.adventure.ruleFound + " · " + rule.title);
    }
    if (isBoss && rank === 1) {
      // Prefix only · bodies in COPY.adventure.bossCleared must not restate
      // "Cleared" (was "BOSS CLEARED · Cleared…" · audit 2026-07-19)
      if (!SAVE.progress.bossBeaten[def.boss]) {
        awards.push("BOSS CLEARED · " + (COPY.adventure.bossCleared[def.boss] || COPY.adventure.bossBeaten));
        // the story moves: each boss's first fall advances the circuit
        const bStory = (COPY.story.bosses || {})[def.boss];
        if (bStory && bStory.defeat) awards.push(bStory.defeat);
      }
      SAVE.progress.bossBeaten[def.boss] = true;
      if (def.boss === "schiff") SAVE.progress.beatSchiff = true;
    }
    SAVE.persistProgress();
    if (checkSatoshiUnlock()) {
      satoshiJustUnlocked = true;
      awards.push(COPY.adventure.satoshiUnlocked);
    }
    if (checkGoldenUnlock()) {
      goldenJustUnlocked = true;
      // title + subtitle as separate lines so the unlock card stays readable
      // on a phone results strip (audit 2026-07-19)
      awards.push("★ " + COPY.adventure.goldenSatoshi);
      awards.push(COPY.adventure.goldenSatoshiSub);
    }
  }

  if (raceCtx.cupState) {
    const cs = raceCtx.cupState;
    for (const r of data.results) {
      cs.points[r.driver.id] = (cs.points[r.driver.id] || 0) + (CUP_POINTS[r.rank - 1] || 0);
    }
  }

  // finale verdict (2026-07-17): victory rolls the credits instead of the
  // results table · the flag survives in progress.genesisRun
  if (raceCtx.mode === "finale") {
    if (rank === 1) {
      SAVE.progress.genesisRun = true;
      SAVE.persistProgress();
      queueCloudPush();
      lastResults = { ...data, awards, newPb, satoshiJustUnlocked, boardPending: false };
      go(() => {
        renderMenu();
        show("menu"); // calm backdrop behind the credits overlay
        renderCredits();
        if (audioReady) Snd.playTheme("victory");
      });
      return;
    }
    awards.push(COPY.finale.defeat);
  }

  queueCloudPush(); // sync any progress/PB earned this race to the X account
  lastResults = { ...data, awards, newPb, satoshiJustUnlocked, goldenJustUnlocked, boardPending: dailyPending };
  // the results reveal + the daily continuation ride the SAME cover: the
  // continuation's staleness guard reads `state`, which must already be
  // "results" when the first network answer can land (an offline fetch
  // rejects in under a frame · outside the cover that answer would race
  // the wipe and the guard would drop a legitimate patch)
  go(() => {
    renderResults(lastResults);
    show("results");
    // P1 earns the victory jingle; everyone else gets the tally loop
    if (audioReady) Snd.playTheme(rank === 1 && raceCtx.mode !== "tt" ? "victory" : "results");

    // detached daily continuation: post the run, fetch today's top ten, and
    // patch the already-visible results screen in place. Guarded so a player
    // who moved on (menu, restart, next daily) never gets a zombie patch.
    if (dailyPending) {
      const day = raceCtx.day;
      const mine = lastResults;
      void (async () => {
        const posted = await postDailyScore(day, data.timeMs);
        const boardData = await fetchDailyBoard(day);
        let board = boardData ? boardData.rows : null;
        if (lastResults !== mine || state !== "results") return; // moved on
        const extra = [];
        // an X-linked player's row wears their @handle (the API resolves
        // the x:{userId} member) · match and credit that name, not the
        // culture handle. A boot-time probe that lost a flaky network gets
        // one retry here so the splice matches the row the server wrote.
        if (xLinkedName === null) xLinkedName = await fetchLinkedHandle();
        const meName = xLinkedName || getHandle();
        if (posted.ok && posted.rank) {
          // reclaim baseline (social board 2026-07-17): the menu compares
          // this against the live board · getting overtaken becomes a
          // named call-out with a one-tap re-race
          store.set("daily-rank:" + day, posted.rank);
          extra.push("DAILY BOARD · ranked #" + posted.rank + " as " + meName);
          // #1 seats their run as the WORLD GHOST everyone races today ·
          // fire-and-forget, the server re-verifies leadership
          if (posted.rank === 1 && data.ghost && data.ghost.length) {
            void uploadLeaderGhost(day, data.timeMs, quantizeGhost(data.ghost));
            extra.push("WORLD GHOST SEATED · the grid races your line now");
          }
        } else if (!posted.ok) extra.push("board offline right now · your time is saved locally");
        // the GET rides a 30s CDN cache: splice our own fresh run in so the
        // player always sees themselves on the board they just posted to
        if (board && posted.ok) {
          const myScore = dailyScore(data.timeMs); // clamped, matches what the server stored
          const row = board.find((r) => r.name === meName);
          if (!row) board.push({ name: meName, score: myScore, verified: !!xLinkedName });
          else if (row.score < myScore) row.score = myScore;
          board = board.sort((a, b) => b.score - a.score);
        }
        mine.board = board;
        patchDailyResults(board, extra);
      })();
    }
  });
}

// fill (or refill) a daily-board container with the top ten
// ---- TODAY'S BOARD · the menu's social centerpiece (2026-07-17) ----

// avatar chip: X-linked rows wear their real profile picture (CSP allows
// exactly pbs.twimg.com for this), everyone else an initials disc
function avatarChip(row) {
  if (row && row.avatar) {
    const img = document.createElement("img");
    img.className = "mb-chip";
    img.src = row.avatar;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => { img.replaceWith(initialsChip(row.name)); });
    return img;
  }
  return initialsChip(row ? row.name : "?");
}
function initialsChip(name) {
  const parts = String(name || "?").replace(/^@/, "").split(/[\s]+/);
  const chip = el("span", "mb-chip mb-initials",
    (parts[0] ? parts[0][0] : "?") + (parts[1] ? parts[1][0] : ""));
  return chip;
}

function menuBoardRow(row, rank, mine) {
  const r = el("div", "mb-row" + (mine ? " me" : ""));
  r.append(
    el("span", "mb-rank", rank === 1 ? "👑" : String(rank)),
    avatarChip(row),
    el("span", "mb-name", row.verified ? row.name + " ✓" : row.name),
    el("span", "mb-time", formatKartTime(row.score)),
  );
  return r;
}

function mountMenuBoard(box, day) {
  const panel = el("div", "menu-board");
  panel.appendChild(el("div", "mb-title", COPY.menuBoard.title));
  const bodyEl = el("div", "mb-body");
  bodyEl.appendChild(el("div", "mb-foot", COPY.menuBoard.syncing));
  panel.appendChild(bodyEl);
  panel.addEventListener("click", () => { unlockAudio(); Snd.sfx("click"); startDaily(); });
  box.appendChild(panel);

  void fetchDailyBoardCached(day).then(async (data) => {
    if (!panel.isConnected) return;
    bodyEl.textContent = "";
    const best = store.get("daily-best:" + day, null);
    if (!data || !data.rows.length) {
      // network down or an empty board: fall back to the quiet local line
      bodyEl.appendChild(el("div", "mb-foot",
        best ? "today's best: " + fmtTime(best) + " as " + (xLinkedName || getHandle()) : COPY.menuBoard.beFirst));
      return;
    }
    if (xLinkedName === null && !xLinkProbed) xLinkedName = await fetchLinkedHandle();
    const meName = xLinkedName || getHandle();
    const rows = data.rows;
    const myIdx = rows.findIndex((r) => r.name === meName || r.name === meName + " ");
    const myRank = myIdx >= 0 ? myIdx + 1 : null;

    // reclaim call-out: someone took the spot you posted (named · personal)
    const stored = store.get("daily-rank:" + day, null);
    if (stored && myRank && myRank > stored) {
      const taker = rows[Math.max(0, myIdx - 1)];
      panel.insertBefore(el("div", "mb-reclaim",
        COPY.menuBoard.reclaim.replace("{name}", taker.verified ? taker.name + " ✓" : taker.name).replace("{rank}", String(stored)) +
        " · " + COPY.menuBoard.reclaimCta), bodyEl);
    }

    // identity strip: who YOU are on this board
    if (best || myRank) {
      bodyEl.appendChild(el("div", "mb-me-strip",
        COPY.menuBoard.racingAs + " " + meName + (xLinkedName ? " ✓" : "") + (myRank ? " · P" + myRank : "")));
    }
    // the podium
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      bodyEl.appendChild(menuBoardRow(rows[i], i + 1, i === myIdx));
    }
    // your heat: the fight you are actually in
    if (myIdx > 2) {
      bodyEl.appendChild(el("div", "mb-divider", "···"));
      for (let i = Math.max(3, myIdx - 1); i <= Math.min(rows.length - 1, myIdx + 1); i++) {
        bodyEl.appendChild(menuBoardRow(rows[i], i + 1, i === myIdx));
      }
      const above = rows[myIdx - 1];
      if (above) {
        const gapMs = above.score - rows[myIdx].score;
        bodyEl.appendChild(el("div", "mb-foot mb-gap",
          (gapMs / 1000).toFixed(1) + "s " + COPY.menuBoard.behind + " " + (above.verified ? above.name + " ✓" : above.name)));
      }
    }
    // footer: scale + the call to race (or the link-X ownership pitch)
    if (!myRank) {
      bodyEl.appendChild(el("div", "mb-foot", data.total + " " + COPY.menuBoard.posted + " · " + COPY.menuBoard.setTime));
    } else if (!xLinkedName && xLinkEnabled) {
      bodyEl.appendChild(el("div", "mb-foot mb-upsell", COPY.menuBoard.linkUpsell));
    }
  });
}

function fillDailyBoard(bd, board) {
  while (bd.children.length > 1) bd.lastChild.remove(); // keep the title
  const mineNames = new Set([getHandle()]);
  if (xLinkedName) mineNames.add(xLinkedName);
  // daily crown · the #1 gets NAMED where the sharing decision happens
  // (an X-linked crown reads @handle ✓ · recognition is the reshare hook)
  if (board.length) {
    const top = board[0];
    bd.appendChild(el("div", "daily-board-crown",
      "👑 " + COPY.results.crownLabel + " · " + (top.verified ? top.name + " ✓" : top.name) + " · " + formatKartTime(top.score)));
  }
  board.slice(0, 10).forEach((r, i) => {
    const row = el("div", "daily-board-row" + (mineNames.has(r.name) ? " me" : ""));
    row.append(
      el("span", "results-rank", String(i + 1)),
      avatarChip(r),
      // X-linked rows carry a server-set verified flag · the ✓ says
      // "only the owner of that X account can post under this name"
      el("span", "results-name", r.verified ? r.name + " ✓" : r.name),
      el("span", "results-time", formatKartTime(r.score)),
    );
    bd.appendChild(row);
  });
}

// late-arriving board data lands on the visible results screen
function patchDailyResults(board, extraAwards) {
  const s = screens.results;
  const bd = s.querySelector(".daily-board");
  if (bd) {
    if (board && board.length) fillDailyBoard(bd, board);
    else { while (bd.children.length > 1) bd.lastChild.remove(); bd.appendChild(el("div", "daily-board-row wait", "board unreachable right now · your time is saved locally")); }
  }
  if (extraAwards.length) {
    let aw = s.querySelector(".results-awards");
    if (!aw) {
      aw = el("div", "results-awards");
      if (bd && bd.parentNode) bd.parentNode.insertBefore(aw, bd);
    }
    for (const a of extraAwards) aw.appendChild(el("div", "results-award", a));
  }
}

// one-shot challenge award · idempotent, toasts through the results
// awards list so it rides the same UI as balloons and codex rules
function awardChallenge(id, awards) {
  if (SAVE.progress.challenges[id]) return;
  SAVE.progress.challenges[id] = true;
  SAVE.persistProgress();
  const c = CHALLENGES.find((x) => x.id === id);
  if (c) {
    awards.push("CHALLENGE COMPLETE · " + c.title);
    if (audioReady) Snd.sfx("award");
  }
}

function endRace() {
  coach.stop();
  if (race) { race.dispose(); race = null; }
}

// ---------- main loop ----------
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const time = t / 1000;
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt <= 0 || dt > 0.5) dt = 1 / 60;
  if (document.hidden) return;

  if (state === "race" && race) {
    const input = readInput(dt);
    if (!racePaused) {
      race.update(dt, input);
      coach.observe(dt);
    }
    race.render(time);
  } else if (state === "hub") {
    atoll.update(dt);
    atoll.render(time);
  } else if (state === "results" && race) {
    race.render(time);
    // photo capture must read pixels in the SAME tick that presented
    // them (no preserveDrawingBuffer) · run any pending request now
    if (photoReq) { const cb = photoReq; photoReq = null; cb(); }
  } else {
    const rm = reduceMotion();
    showroom.update(dt, rm);
    showroom.render(time, rm);
  }
}
requestAnimationFrame(frame);

// boot straight to title · flush any unsent daily score from last time
retryUnsent();
// veteran grace: a save with real progress predates RACE SCHOOL · retire
// the basics silently so long-time players are never coached on lesson
// one. The gap warning stays armed for everyone once (the severed decks
// are newer than any veteran's muscle memory).
if (SAVE.progress.beatSchiff || SAVE.totalBalloons() >= 6 || Object.keys(SAVE.pbs || {}).length > 0) {
  for (const id of ["coach:rocket", "coach:drift", "coach:item", "coach:sats"]) {
    if (!storySeen(id)) markStorySeen(id);
  }
}
show("title");

// dare deep links (2026-07-16): /bitcoin-kart?ghost=<id> lands on the
// challenge interstitial for that shared ghost · ?ghost=daily jumps
// straight into today's circuit (the world-best ghost already rides it ·
// the evergreen link for the operator's daily X post). Invalid or
// expired ids fall through to the normal title screen silently.
{
  let dare = null;
  try { dare = new URLSearchParams(location.search).get("ghost"); } catch { /* ancient engine · title as usual */ }
  if (dare === "daily") {
    startDaily();
  } else if (dare && /^[a-f0-9]{8,16}$/.test(dare)) {
    void fetchDareGhost(dare).then((g) => {
      if (g && trackById(g.trackId) && state !== "race") renderDareIntro(g, dare);
    });
  }
}

// optional X identity: the site's Link X flow sets an HttpOnly session
// cookie this static page can't read · one no-store probe caches the
// linked "@handle" (null = anonymous / feature off) for board matching
// plus whether the sitewide feature is configured at all (state +
// mountXLinkRow live near the top of the module so every screen can use
// them; the probe fires here at boot).
void fetchLinkState().then((st) => {
  xLinkedName = st.handle;
  xLinkEnabled = st.enabled;
  xLinkProbed = true;
  for (const paint of xLinkPaints.splice(0)) paint();
  // pull this X account's progress from the cloud and merge it in
  if (xLinkedName) cloudSyncNow(true);
});

// offline: register the game-scoped service worker (network-first ·
// sw.js). The widened "/bitcoin-kart" scope is authorized by a
// Service-Worker-Allowed header in next.config.ts. Failure is silent ·
// the game simply stays online-only.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/bitcoin-kart/sw.js", { scope: "/bitcoin-kart" }).catch(() => { /* online-only */ });
}

// idle prewarm: paint every driver's face, bake every kart's geometry AND
// seat the GPU-side cache (VAOs + face textures via kartGL) while the
// title idles, one driver per idle slice · race start then reuses the
// session cache instead of uploading ~20MB of textures during the intro
{
  const pending = ROSTER.map((d) => d.id);
  const idle = window.requestIdleCallback
    ? (f) => requestIdleCallback(f, { timeout: 4000 })
    : (f) => setTimeout(f, 250);
  const step = () => {
    const id = pending.shift();
    if (!id) return;
    const d = ROSTER.find((x) => x.id === id);
    paintFace(id);
    kartGL(R, d);
    if (pending.length) idle(step);
  };
  idle(step);
}
