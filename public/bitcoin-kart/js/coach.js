// BITCOIN KART · coach.js
// RACE SCHOOL · the first-play coach (2026-07-21). Just-in-time lessons
// during a player's early races: the rocket start on the countdown, the
// drift mini turbo at the first corner, item fire, sats, and the gap
// warning. Pure observer: it polls the race handle after race.update()
// every frame (main.js game loop) and never touches race internals.
// Lessons persist as storySeen beat ids ("coach:*") so they fire once
// ever, ride the arcade cloud OR-merge for free, and replay under
// ?debug=story. All DOM goes through hud.js el() · no HTML strings.

import { el } from "./hud.js";
import { COPY } from "./data.js";

// lesson ids in priority order · one card on screen at a time
const LESSONS = ["rocket", "gap", "drift", "item", "sats"];

export function createCoach(deps) {
  // deps: { storySeen(id), markStorySeen(id), store, settings }
  let race = null, ctx = null;
  let node = null, lineEl = null;
  let cur = null;      // active lesson id
  let curT = 0;        // seconds the card has been up
  let stage = 0;       // drift lesson: 0 = hold, 1 = release
  let okT = -1;        // >= 0: success flash, hide when it reaches 0
  let mem = null;      // per-race transition memory

  const seen = (id) => deps.storySeen("coach:" + id);
  const learn = (id) => deps.markStorySeen("coach:" + id);

  function ensureNode(hudRoot) {
    if (node && node.parentNode === hudRoot) return;
    node = el("div", "hud-coach");
    node.appendChild(el("div", "hud-coach-eyebrow", COPY.coach.eyebrow));
    lineEl = el("div", "hud-coach-line");
    node.appendChild(lineEl);
    node.appendChild(el("div", "hud-coach-dismiss", "Tap to close"));
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (cur === "drift") dismissDrift();
      hide();
    });
    hudRoot.appendChild(node);
  }

  // A dismissed drift card must not pop straight back. Two dismissals
  // retire the lesson for good. Learning it (mini turbo) is separate.
  function dismissDrift() {
    if (mem) mem.driftRetired = true;
    const n = (deps.store.get("coach-drift-n", 0) || 0) + 1;
    deps.store.set("coach-drift-n", n);
    if (n >= 2) learn("drift");
  }

  // parts: string | {k:"KEY"} chips, or a plain string
  function setLine(parts) {
    lineEl.textContent = "";
    for (const p of Array.isArray(parts) ? parts : [parts]) {
      if (typeof p === "string") lineEl.appendChild(document.createTextNode(p));
      else lineEl.appendChild(el("span", "coach-key", p.k));
    }
  }

  function show(id, parts) {
    cur = id;
    curT = 0;
    okT = -1;
    setLine(parts);
    delete node.dataset.ok;
    node.dataset.on = "1";
    // retrigger the entrance
    node.classList.remove("pop");
    void node.offsetWidth;
    node.classList.add("pop");
  }

  function succeed(text) {
    if (!cur) return;
    learn(cur);
    setLine(text);
    node.dataset.ok = "1";
    okT = 1.4;
  }

  function hide() {
    cur = null;
    stage = 0;
    okT = -1;
    if (node) { node.dataset.on = "0"; delete node.dataset.ok; }
  }

  function rocketParts() {
    if (ctx.touch && ctx.autoGas) return COPY.coach.rocketAuto;
    if (ctx.touch) return COPY.coach.rocketGas;
    return COPY.coach.rocketKb;
  }

  return {
    start(r, c) {
      race = r;
      ctx = c;
      mem = {
        phase: "", runT: 0, drifted: false, miniSeen: false, driftRetired: false,
        itemSettled: false, itemsUsed0: r.player.itemsUsed || 0,
        sats0: r.player.sats || 0, fellOnce: false, rocketShown: false,
      };
      // solo and ceremonial modes coach nothing · neither does the off switch
      if (!deps.settings.coachTips || c.mode === "tt" || c.mode === "challenge" || c.mode === "finale") {
        race = null;
        return;
      }
      ensureNode(c.hudRoot);
      hide();
    },

    observe(dt) {
      if (!race || !mem) return;
      const p = race.player;
      const phase = race.getPhase();
      const track = race.track;

      if (okT >= 0) {
        okT -= dt;
        if (okT < 0) hide();
        return;
      }
      if (cur) curT += dt;

      // ---- rocket start · taught on the countdown itself ----
      if (phase === "count" && mem.phase !== "count" && !seen("rocket")) {
        // nag control is device-local: two showings, then it retires even
        // unlearned (success before that marks it learned immediately)
        const n = deps.store.get("coach-rocket-n", 0);
        if (n < 2) {
          deps.store.set("coach-rocket-n", n + 1);
          mem.rocketShown = true;
          show("rocket", rocketParts());
        }
      }
      if (phase === "run" && mem.phase === "count") mem.runT = 0;
      if (phase === "run") mem.runT += dt;
      if (cur === "rocket") {
        if (p.boostKind === "start") succeed(COPY.coach.rocketDone);
        else if (phase === "run" && mem.runT > 1.2) hide(); // missed · card re-arms next race
      }

      if (phase === "run" && !p.finished) {
        // ---- gap warning · the deck is out ahead ----
        if (!cur && track.gapAt && !seen("gap")) {
          for (let g = 8; g < 55; g++) {
            if (track.gapAt((p.sIdx + g) % track.S.n)) { show("gap", COPY.coach.gap); break; }
          }
        }
        if (cur === "gap" && (curT > 3.2 || p.falling)) { learn("gap"); hide(); }

        // ---- drift mini turbo · two stages ----
        const mini = p.boostKind === "mini";
        if (mini) mem.miniSeen = true;
        if (!seen("drift")) {
          if (mem.miniSeen && cur !== "drift") learn("drift"); // already knows
          else if (!cur && !mem.driftRetired && mem.runT > 5 && p.speed > 22 && !p.drift.active) {
            show("drift", ctx.touch ? COPY.coach.driftTouch : COPY.coach.driftKb);
            stage = 0;
          } else if (cur === "drift") {
            if (stage === 0 && p.drift.active && p.drift.tier >= 1) {
              setLine(ctx.touch ? COPY.coach.driftReleaseTouch : COPY.coach.driftRelease);
              stage = 1;
              curT = 0;
            }
            if (mini) succeed(COPY.coach.driftDone);
            else if (stage === 0 && curT > 5) { dismissDrift(); hide(); }
            else if (stage === 1 && curT > 4) { dismissDrift(); hide(); }
            else if (stage === 1 && !p.drift.active && curT > 0.6 && !mini) { dismissDrift(); hide(); }
          }
        }

        // ---- item fire ----
        const held = p.item !== null && p.roulette <= 0;
        if (held) mem.itemSettled = true;
        if (!seen("item")) {
          const used = (p.itemsUsed || 0) > mem.itemsUsed0;
          if (used && cur !== "item") learn("item"); // fired before the lesson
          else if (!cur && mem.itemSettled && held) show("item", ctx.touch ? COPY.coach.itemTouch : COPY.coach.itemKb);
          else if (cur === "item") {
            if (used) succeed(COPY.coach.itemDone);
            else if (curT > 6 || !held) hide();
          }
        }

        // ---- sats ----
        if (!seen("sats") && !cur && p.sats > mem.sats0 && p.sats > 0) {
          show("sats", COPY.coach.sats);
        }
        if (cur === "sats" && curT > 4) { learn("sats"); hide(); }
      }

      mem.phase = phase;
    },

    stop() {
      race = null;
      mem = null;
      hide();
    },

    dispose() {
      this.stop();
      if (node) { node.remove(); node = null; lineEl = null; }
    },
  };
}
