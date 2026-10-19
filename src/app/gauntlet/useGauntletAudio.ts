"use client";

/* =====================================================================
 * useGauntletAudio · opt-in WebAudio for both Gauntlet games
 * (ported from the operator's Horizon spec, 2026-07-08).
 *
 * Same contract as the PressureGauge sound hook: procedural synthesis
 * only (lib/audio-synth primitives · no files), DEFAULT OFF, lazy
 * AudioContext init bound to the first user gesture, resume() on
 * every play for Safari's suspended-context behavior. One preference
 * shared by the trading cabinet and the Runner (gm:g2:audio).
 *
 * Sound vocabulary stays in the house brass-and-glass register:
 * coins drop when you buy, the vault thuds when fear hits, glass
 * shatters on liquidation and runner death, brass rings the stamp.
 * ===================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  brassBell,
  coinDrop,
  glassShatter,
  glassTap,
  metalTap,
  rocketWhoosh,
  vaultThud,
} from "@/lib/audio-synth";
import { haptic } from "@/lib/haptics";

const K_AUDIO = "gm:g2:audio";
// Master gain for the two arcade games (NOT the /stack gauge, which owns
// a separate hook). Bumped from 0.07 · players said the game was too
// quiet (2026-07-10). A compressor after this stage lets us push level
// without clipping the dense sounds (glass shatter, launch fanfare).
const VOLUME = 0.16;

export type GauntletSound =
  | "buy"
  | "sell"
  | "card-fear"
  | "card-euphoria"
  | "card-bill"
  | "card-margin"
  | "liq"
  | "stamp"
  | "jump"
  | "jump2"
  | "land"
  | "collect"
  | "combo"
  | "launch"
  | "death"
  | "summit";

export function useGauntletAudio(): {
  audioOn: boolean;
  toggleAudio: () => void;
  play: (kind: GauntletSound, level?: number) => void;
} {
  const [audioOn, setAudioOn] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const onRef = useRef(false);
  onRef.current = audioOn;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(K_AUDIO) === "1") setAudioOn(true);
    } catch {
      /* private mode · stays off */
    }
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      masterRef.current = null;
    };
  }, []);

  const ensureCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    // iOS · route Web Audio as "playback" so it is NOT muted by the
    // hardware ring/silent switch. Safari AND Chrome on iPhone are both
    // WebKit and honor that switch by default, which is why the game
    // was silent on iOS even after the desktop-Safari unlock landed
    // (bug report 2026-07-09). navigator.audioSession is iOS 16.4+;
    // best-effort, absent everywhere else.
    try {
      const session = (
        navigator as unknown as { audioSession?: { type: string } }
      ).audioSession;
      if (session) session.type = "playback";
    } catch {
      /* not available · nothing to do */
    }
    const master = ctx.createGain();
    master.gain.value = VOLUME;
    // Compressor between master and output · glues the layered sounds
    // and lets us run a hotter master without the dense hits (glass
    // shatter, the launch fanfare) clipping into distortion. Makes the
    // whole game read as louder AND cleaner (2026-07-10).
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 22;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    master.connect(comp);
    comp.connect(ctx.destination);
    ctxRef.current = ctx;
    masterRef.current = master;
    // Safari unlock ritual: a one-sample silent buffer started inside
    // the gesture, plus resume(). Chrome ignores the extra buffer;
    // WebKit requires an actual source to have played before it
    // treats the context as user-activated (Runner bug 2026-07-09 ·
    // sounds fired from the game loop stayed suspended forever).
    try {
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, 22050);
      silent.connect(ctx.destination);
      silent.start(0);
    } catch {
      /* the resume below still applies */
    }
    ctx.resume().catch(() => {});
    return ctx;
  }, []);

  const toggleAudio = useCallback(() => {
    const turningOn = !onRef.current;
    if (turningOn) {
      // Unlock + confirm INSIDE the tap gesture. The strongest iOS
      // activation is a REAL audible node started in the gesture (not
      // a silent buffer): iPhone Safari/Chrome only trust the audio
      // path once something has actually sounded from a user action.
      // It doubles as instant feedback · if you hear this tap, sound
      // is live; if game sounds are then missing, that's a different
      // problem (bug report 2026-07-09 · the gauge worked but the
      // Runner did not on the same device).
      const ctx = ensureCtx();
      if (ctx && masterRef.current) {
        ctx.resume().catch(() => {});
        try {
          metalTap(
            { ctx, master: masterRef.current },
            ctx.currentTime + 0.01,
            1320,
            0.6,
          );
        } catch {
          /* the resume above still unlocks the context */
        }
      }
    }
    setAudioOn(turningOn);
    try {
      window.localStorage.setItem(K_AUDIO, turningOn ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }, [ensureCtx]);

  // Saved-preference path: audio restores ON from localStorage with
  // no toggle click this session, so the first unlock gesture is
  // whatever the player does next. One-shot listeners on the gesture
  // types WebKit honors (pointerDOWN is not among them) unlock the
  // context, then remove themselves.
  useEffect(() => {
    if (!audioOn) return;
    const ctx = ctxRef.current;
    if (ctx && ctx.state === "running") return;
    const unlock = () => {
      const c = ensureCtx();
      c?.resume().catch(() => {});
      if (!c || c.state === "running") detach();
    };
    const EVENTS = ["pointerup", "touchend", "keydown", "click"] as const;
    const detach = () => {
      for (const ev of EVENTS) window.removeEventListener(ev, unlock, true);
    };
    for (const ev of EVENTS) window.addEventListener(ev, unlock, true);
    return detach;
  }, [audioOn, ensureCtx]);

  const play = useCallback(
    (kind: GauntletSound, level = 0) => {
      if (!onRef.current) return;
      const ctx = ensureCtx();
      if (!ctx || !masterRef.current) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      const s = { ctx, master: masterRef.current };

      switch (kind) {
        case "buy":
          coinDrop(s, t0, 5200, 0.5);
          haptic("needleTick", true);
          break;
        case "sell":
          metalTap(s, t0, 900, 0.5);
          haptic("needleTick", true);
          break;
        case "card-fear":
          vaultThud(s, t0, 0.7);
          break;
        case "card-euphoria":
          brassBell(s, t0, 660, 1.1, 0.35);
          break;
        case "card-bill":
          metalTap(s, t0, 1400, 0.45);
          metalTap(s, t0 + 0.12, 1150, 0.4);
          break;
        case "card-margin":
          glassTap(s, t0, 0.45);
          break;
        case "liq":
        case "death":
          // A sharper impact under the shatter · the fall lands with
          // weight now, not just glass.
          vaultThud(s, t0, 0.5);
          glassShatter(s, t0 + 0.02, 0.7);
          haptic("glassShatter", true);
          break;
        case "stamp":
          vaultThud(s, t0, 0.55);
          brassBell(s, t0 + 0.12, 523, 1.5, 0.32);
          break;
        case "jump":
          // Grounded launch · a springy two-tone flick with body.
          metalTap(s, t0, 1700, 0.5);
          metalTap(s, t0 + 0.02, 2550, 0.32);
          haptic("needleTick", true);
          break;
        case "jump2":
          // Air jump · lighter, higher, with a tiny whoosh of effort.
          metalTap(s, t0, 3100, 0.42);
          glassTap(s, t0 + 0.01, 0.28);
          break;
        case "land":
          // Soft touchdown · a low tap, quiet so it never nags.
          metalTap(s, t0, 460, 0.32);
          break;
        case "collect": {
          // Sats orb · pitch climbs with the combo so a long chain
          // sings up a scale. Caps so it never gets shrill.
          const step = Math.min(level, 10);
          const pitch = 3600 + step * 320;
          coinDrop(s, t0, pitch, 0.5);
          if (step >= 3) {
            // A little sparkle rides the higher combos.
            metalTap(s, t0 + 0.015, pitch * 1.5, 0.22);
          }
          break;
        }
        case "combo":
          // Milestone chime · a bright ascending two-note ring when a
          // chain crosses a threshold (5, 10, ...).
          brassBell(s, t0, 880, 0.7, 0.3);
          brassBell(s, t0 + 0.1, 1174, 0.9, 0.28);
          haptic("needleTick", true);
          break;
        case "launch": {
          // TO THE MOON · the payoff. A rocket roar under an ascending
          // major-chord brass fanfare (root, third, fifth, octave).
          rocketWhoosh(s, t0, 1.4, 0.6);
          const root = 392; // G4 · triumphant, not shrill
          const chord = [1, 1.25, 1.5, 2];
          chord.forEach((r, i) => {
            brassBell(s, t0 + 0.12 + i * 0.11, root * r, 1.6, 0.32);
          });
          haptic("glassShatter", true);
          break;
        }
        case "summit":
          // Reached the moon surface / a hard-won moon crash · brass
          // over a settling thud. Celebratory but final.
          brassBell(s, t0, 784, 1.2, 0.34);
          brassBell(s, t0 + 0.18, 1046, 1.6, 0.32);
          vaultThud(s, t0 + 0.05, 0.4);
          haptic("glassShatter", true);
          break;
      }
    },
    [ensureCtx],
  );

  return { audioOn, toggleAudio, play };
}
