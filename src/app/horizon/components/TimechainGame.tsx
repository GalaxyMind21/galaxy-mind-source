"use client";

/* =====================================================================
 * Timechain · the one-tap block stacker (full rebuild 2026-07-09).
 *
 * The old Horizon Arena (chase-a-ring aim trainer) failed the operator's
 * playtest: precision 2D pointing is wrong for a thumb (your finger
 * covers the target), the HUD row overflowed iPhones, the reservoir was
 * a frame-in-a-frame, and the theme was bitcoin-in-name-only. This is a
 * ground-up replacement built on the arcade's proven mobile pattern
 * (the Runner): ONE input, full-bleed canvas, HUD painted on the canvas,
 * HTML overlays only for intro/death.
 *
 * The loop: a block slides across the screen · tap anywhere to drop it
 * on the chain. Clean drops keep their width; overhang is sliced away,
 * so sloppy stacking narrows the chain until a full miss orphans it.
 * EVERY 21 BLOCKS THE REWARD HALVES and the chain speeds up · the
 * difficulty curve IS the halving schedule, and the score is the sats
 * you banked. Early blocks pay 50, then 25, then 12.5 · being early
 * pays more. That is the most bitcoin-native mechanic the arcade has.
 *
 * All hot state lives in refs · React renders only the overlays.
 * ===================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { getHandle, submitScore } from "@/lib/arcade";
import { useArcadeCloud } from "@/lib/useArcadeCloud";
import { useGauntletAudio } from "@/app/gauntlet/useGauntletAudio";

const BLOCK_H = 26; // px per block row
const HALVING_EVERY = 21; // compressed halving epoch (a wink at 21M)
const PERFECT_FRAC = 0.16; // |offset| within this fraction of width snaps
const START_SUBSIDY = 50; // BTC per block in epoch 0
const BEST_KEY = "gm:tc:best"; // {s: sats, h: height}

// Epoch tints · the chain visibly ages as the subsidy halves.
const EPOCH_COLORS = [
  "#F7931A",
  "#FFB454",
  "#E8862E",
  "#C96F1C",
  "#A85A12",
  "#8A4A0E",
];

type Phase = "intro" | "running" | "dead";

type Best = { s: number; h: number };

type DeathInfo = {
  height: number;
  sats: number;
  epochSubsidy: number;
  isBest: boolean;
};

function readBest(): Best | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}

function subsidyFor(height: number): number {
  return START_SUBSIDY / 2 ** Math.floor(height / HALVING_EVERY);
}

/** Payout in sats-points · bounded: even endless perfect play with the
 *  max combo sums under 1.3M, safely inside the server's 1.5M bound. */
function payoutFor(height: number, precision: number, combo: number): number {
  return Math.round(subsidyFor(height) * 200 * precision * combo);
}

export function TimechainGame({
  liveTipHeight,
}: {
  /** The REAL chain tip right now · shown for flavor ("the real chain
   *  is at block N · yours starts at zero"). 0 hides the line. */
  liveTipHeight: number;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [deathRank, setDeathRank] = useState<number | null>(null);
  const [best, setBest] = useState<Best | null>(null);

  const { audioOn, toggleAudio, play } = useGauntletAudio();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("intro");
  const reducedMotion = useRef(false);
  // Tap discrimination (scroll-trap fix) + death-screen input grace.
  const tapRef = useRef<{ x: number; y: number; t: number; curX: number } | null>(null);
  const diedAtRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    // Strict Mode double-invokes effects in dev (setup → cleanup →
    // setup) · without re-arming here the ref stays false forever and
    // the board rank silently never renders in dev (review 2026-07-09).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Live game state · refs only, no React in the hot path.
  const g = useRef({
    // landed blocks · x = left edge (canvas px), w = width; index = height
    blocks: [] as { x: number; w: number }[],
    curX: 0,
    curW: 0,
    dir: 1,
    height: 0, // blocks placed so far = index of the sliding block
    sats: 0,
    streak: 0, // consecutive perfects
    camY: 0, // camera offset · world y is -height*BLOCK_H for the top
    lastTs: null as number | null,
    // falling sliced-off pieces
    chips: [] as { x: number; y: number; w: number; vy: number; life: number }[],
    // floating score text
    floats: [] as { x: number; y: number; life: number; text: string; color: string }[],
    // center banners (halving)
    banner: null as { text: string; sub: string; life: number } | null,
    flash: 0, // perfect-drop flash
    dead: false,
  });

  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setBest(readBest());
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const comboFor = (streak: number) => Math.min(3, 1 + streak * 0.25);

  // cross-device cloud save (X-linked players · 2026-07-18): one record
  // {s: sats, h: height}. Sats is the ordering key (higher wins); height
  // rides along with the winning record for display.
  const readCloud = useCallback(() => ({ best: readBest() }), []);
  const adoptCloud = useCallback((m: { best?: { s?: number; h?: number } | null }) => {
    const mb = m && m.best;
    if (!mb || typeof mb.s !== "number" || typeof mb.h !== "number") return;
    const cur = readBest();
    if (cur && mb.s <= cur.s) return; // never regress the personal best
    try {
      window.localStorage.setItem(BEST_KEY, JSON.stringify({ s: mb.s, h: mb.h }));
    } catch { /* best-effort */ }
    setBest({ s: mb.s, h: mb.h });
  }, []);
  const pushCloud = useArcadeCloud("horizon", readCloud, adoptCloud);

  const die = useCallback(
    (finalHeight: number, finalSats: number) => {
      const s = g.current;
      if (s.dead) return;
      s.dead = true;
      diedAtRef.current = performance.now();
      const prev = readBest();
      const isBest = !prev || finalSats > prev.s;
      if (isBest) {
        try {
          window.localStorage.setItem(
            BEST_KEY,
            JSON.stringify({ s: finalSats, h: finalHeight }),
          );
        } catch {
          /* best-effort */
        }
        setBest({ s: finalSats, h: finalHeight });
      }
      setDeath({
        height: finalHeight,
        sats: finalSats,
        epochSubsidy: subsidyFor(Math.max(0, finalHeight - 1)),
        isBest,
      });
      setDeathRank(null);
      setPhase("dead");
      phaseRef.current = "dead";
      pushCloud(); // sync the personal best to the X account (linked players)
      // Delight moment · invite a home-screen install (InstallNudge).
      try {
        window.dispatchEvent(new CustomEvent("gm:arcade-finished"));
      } catch {
        /* no window · ignore */
      }
      // Height rides the score's fraction (like the Runner's sats) so
      // the board can show "12,400 sats · height 34".
      if (finalSats > 0) {
        submitScore(
          "horizon",
          finalSats + Math.min(finalHeight, 999) / 1000,
        ).then((res) => {
          if (mountedRef.current && res && res.rank != null)
            setDeathRank(res.rank);
        });
      }
      play("death");
      track("timechain_death", { height: finalHeight, sats: finalSats });
    },
    [play],
  );

  // ── The tap · the game's only verb. ────────────────────────────────
  const drop = useCallback((xOverride?: number) => {
    const s = g.current;
    if (phaseRef.current !== "running" || s.dead) return;
    const dropX = xOverride ?? s.curX;
    const top =
      s.blocks.length > 0 ? s.blocks[s.blocks.length - 1] : null;
    const canvas = canvasRef.current;
    const cw = canvas ? canvas.clientWidth : 360;

    if (!top) {
      // The first block IS the foundation · it lands wherever you set
      // it, full width, and pays a plain epoch-0 reward.
      const gain = payoutFor(0, 1, 1);
      s.sats += gain;
      s.floats.push({
        x: dropX + s.curW / 2,
        y: -BLOCK_H - 12,
        life: 0.9,
        text: `+${gain.toLocaleString("en-US")}`,
        color: "#FFD9A0",
      });
      s.blocks.push({ x: dropX, w: s.curW });
      s.height = 1;
      s.dir = -1;
      s.curX = cw - s.curW * 0.4;
      play("collect");
      return;
    }

    const baseX = top.x;
    const baseW = top.w;

    const left = Math.max(dropX, baseX);
    const right = Math.min(dropX + s.curW, baseX + baseW);
    const overlap = right - left;

    if (overlap <= 2) {
      // Clean miss · the block tumbles, the chain is orphaned.
      s.chips.push({
        x: dropX,
        y: -(s.height + 1) * BLOCK_H,
        w: s.curW,
        vy: -60,
        life: 1.2,
      });
      die(s.height, s.sats);
      return;
    }

    const offset = Math.abs(dropX - baseX);
    const perfect = offset <= s.curW * PERFECT_FRAC;
    let newX = left;
    let newW = overlap;
    let precision: number;

    if (perfect) {
      // Snap flush · keep the full width.
      newX = baseX;
      newW = Math.min(s.curW, baseW);
      precision = 1;
      s.streak += 1;
      s.flash = 0.4;
      play("collect");
    } else {
      // Slice the overhang · it falls away.
      precision = overlap / s.curW;
      s.streak = 0;
      const y = -(s.height + 1) * BLOCK_H;
      if (dropX < baseX) {
        s.chips.push({ x: dropX, y, w: left - dropX, vy: -30, life: 1 });
      } else {
        s.chips.push({ x: right, y, w: dropX + s.curW - right, vy: -30, life: 1 });
      }
      play("card-bill");
    }

    const combo = comboFor(s.streak);
    const gain = payoutFor(s.height, precision, combo);
    s.sats += gain;
    s.floats.push({
      x: newX + newW / 2,
      y: -s.height * BLOCK_H - 12,
      life: 0.9,
      text: perfect
        ? `PERFECT +${gain.toLocaleString("en-US")}`
        : `+${gain.toLocaleString("en-US")}`,
      color: perfect ? "#31C48D" : "#FFD9A0",
    });
    if (s.floats.length > 6) s.floats.shift();

    s.blocks.push({ x: newX, w: newW });
    s.height += 1;

    // The halving · the game's clock and its bitcoin heart.
    if (s.height % HALVING_EVERY === 0) {
      const nextSub = subsidyFor(s.height);
      s.banner = {
        text: "THE HALVING",
        sub: `block reward is now ₿${nextSub}`,
        life: 2.2,
      };
      play("card-euphoria");
    }

    // Next block · same width, enters from the other side.
    s.curW = newW;
    s.dir = s.height % 2 === 0 ? 1 : -1;
    s.curX = s.dir === 1 ? -newW * 0.6 : cw - newW * 0.4;
  }, [die, play]);

  // ── Start / restart ─────────────────────────────────────────────────
  const start = useCallback(() => {
    const canvas = canvasRef.current;
    const cw = canvas ? canvas.clientWidth : 360;
    const s = g.current;
    const w = Math.min(cw * 0.6, 280);
    s.blocks = [];
    s.curW = w;
    s.curX = -w * 0.6;
    s.dir = 1;
    s.height = 0;
    s.sats = 0;
    s.streak = 0;
    s.camY = 0;
    s.lastTs = null;
    s.chips = [];
    s.floats = [];
    s.banner = null;
    s.flash = 0;
    s.dead = false;
    setDeath(null);
    setDeathRank(null);
    setPhase("running");
    phaseRef.current = "running";
    track("timechain_start");
  }, []);

  // ── The frame ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const frame = (ts: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const s = g.current;
      if (s.lastTs == null) s.lastTs = ts;
      let dt = Math.min(0.05, (ts - s.lastTs) / 1000);
      s.lastTs = ts;
      // The world must not move while the player cannot see it.
      if (document.hidden) dt = 0;

      const epoch = Math.floor(s.height / HALVING_EVERY);

      // Advance the sliding block · speed ramps per block AND per epoch.
      if (phaseRef.current === "running" && !s.dead) {
        const speed = Math.min(
          460,
          (120 + s.height * 6) * 1.12 ** epoch,
        );
        s.curX += s.dir * speed * dt;
        if (s.curX <= 6) {
          s.curX = 6;
          s.dir = 1;
        } else if (s.curX + s.curW >= cw - 6) {
          s.curX = cw - 6 - s.curW;
          s.dir = -1;
        }
      }

      // Camera follows the top of the chain.
      const topWorldY = -s.height * BLOCK_H;
      const targetCam = ch * 0.62 - topWorldY;
      s.camY += (targetCam - s.camY) * Math.min(1, dt * 6);
      const Y = (worldY: number) => worldY + s.camY;

      // ── Draw ──
      // Sky · deep night with a warm horizon glow at the base of the chain.
      const sky = ctx.createLinearGradient(0, 0, 0, ch);
      sky.addColorStop(0, "#08080B");
      sky.addColorStop(0.72, "#0E0A08");
      sky.addColorStop(1, "#1A0F06");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, cw, ch);

      // Stars · fixed pattern, parallax with the camera.
      ctx.fillStyle = "rgba(235,225,210,0.5)";
      let seed = 9973;
      for (let i = 0; i < 46; i++) {
        seed = (seed * 16807) % 2147483647;
        const sx = seed % cw;
        seed = (seed * 16807) % 2147483647;
        const syBase = seed % (ch * 3);
        const sy = (((syBase + s.camY * 0.15) % (ch + 40)) + ch + 40) % (ch + 40) - 20;
        seed = (seed * 16807) % 2147483647;
        ctx.globalAlpha = 0.2 + (seed % 40) / 100;
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;

      // Genesis plinth.
      const plinthY = Y(BLOCK_H * 0.4);
      ctx.fillStyle = "#1c150d";
      ctx.fillRect(0, plinthY, cw, Math.max(0, ch - plinthY));
      ctx.strokeStyle = "rgba(247,147,26,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, plinthY);
      ctx.lineTo(cw, plinthY);
      ctx.stroke();
      if (plinthY < ch - 6) {
        ctx.fillStyle = "rgba(235,225,210,0.55)";
        ctx.font = "600 10px ui-monospace, monospace";
        ctx.textAlign = "center";
        // Narrow phones get the short form · canvas text does not wrap.
        const genesisFull =
          "GENESIS · 03/JAN/2009 · CHANCELLOR ON BRINK OF SECOND BAILOUT";
        const genesis =
          ctx.measureText(genesisFull).width <= cw - 16
            ? genesisFull
            : "GENESIS · 03/JAN/2009";
        ctx.fillText(genesis, cw / 2, Math.min(ch - 8, plinthY + 16));
        ctx.textAlign = "left";
      }

      // Landed blocks.
      for (let i = 0; i < s.blocks.length; i++) {
        const b = s.blocks[i];
        const by = Y(-(i + 1) * BLOCK_H) + BLOCK_H * 0.4;
        if (by > ch + BLOCK_H || by < -BLOCK_H * 2) continue;
        const col = EPOCH_COLORS[Math.min(EPOCH_COLORS.length - 1, Math.floor(i / HALVING_EVERY))];
        ctx.fillStyle = col;
        ctx.fillRect(b.x, by, b.w, BLOCK_H - 3);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(b.x, by + BLOCK_H - 8, b.w, 5);
        // Subsidy label on roomy blocks · the halving made visible.
        if (b.w > 64 && (i % HALVING_EVERY === 0 || i === s.blocks.length - 1)) {
          ctx.fillStyle = "rgba(20,10,2,0.85)";
          ctx.font = "700 11px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`₿${subsidyFor(i)}`, b.x + b.w / 2, by + BLOCK_H / 2 + 2);
          ctx.textAlign = "left";
        }
      }

      // The sliding block.
      if (phaseRef.current === "running" && !s.dead) {
        const by = Y(-(s.height + 1) * BLOCK_H) + BLOCK_H * 0.4;
        const col = EPOCH_COLORS[Math.min(EPOCH_COLORS.length - 1, epoch)];
        ctx.shadowColor = "rgba(247,147,26,0.7)";
        ctx.shadowBlur = 14;
        ctx.fillStyle = col;
        ctx.fillRect(s.curX, by, s.curW, BLOCK_H - 3);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(s.curX, by, s.curW, 4);
        // Drop guide · a faint plumb line onto the stack.
        const top = s.blocks[s.blocks.length - 1];
        if (top && !reducedMotion.current) {
          ctx.strokeStyle = "rgba(235,225,210,0.10)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(s.curX, by + BLOCK_H);
          ctx.lineTo(s.curX, Y(-s.height * BLOCK_H) + BLOCK_H * 0.4);
          ctx.moveTo(s.curX + s.curW, by + BLOCK_H);
          ctx.lineTo(s.curX + s.curW, Y(-s.height * BLOCK_H) + BLOCK_H * 0.4);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Perfect flash.
      if (s.flash > 0) {
        s.flash = Math.max(0, s.flash - dt);
        const top = s.blocks[s.blocks.length - 1];
        if (top) {
          const by = Y(-s.blocks.length * BLOCK_H) + BLOCK_H * 0.4;
          ctx.strokeStyle = `rgba(49,196,141,${s.flash * 2})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(top.x - 3, by - 3, top.w + 6, BLOCK_H + 3);
        }
      }

      // Falling sliced chips.
      for (const c of s.chips) {
        c.vy += 900 * dt;
        c.y += c.vy * dt;
        c.life -= dt;
        ctx.globalAlpha = Math.max(0, c.life);
        ctx.fillStyle = "#8A4A0E";
        ctx.fillRect(c.x, Y(c.y) + BLOCK_H * 0.4, c.w, BLOCK_H - 3);
      }
      ctx.globalAlpha = 1;
      s.chips = s.chips.filter((c) => c.life > 0);

      // Score floats.
      ctx.font = "700 13px ui-monospace, monospace";
      ctx.textAlign = "center";
      for (const f of s.floats) {
        f.y -= 28 * dt;
        f.life -= dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, Y(f.y));
      }
      ctx.globalAlpha = 1;
      s.floats = s.floats.filter((f) => f.life > 0);

      // Halving banner.
      if (s.banner) {
        s.banner.life -= dt;
        const a = Math.max(0, Math.min(1, s.banner.life));
        ctx.globalAlpha = a;
        ctx.fillStyle = "#F7931A";
        ctx.font = "800 26px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(s.banner.text, cw / 2, ch * 0.3);
        ctx.fillStyle = "#FFD9A0";
        ctx.font = "600 14px ui-monospace, monospace";
        ctx.fillText(s.banner.sub, cw / 2, ch * 0.3 + 24);
        ctx.globalAlpha = 1;
        ctx.textAlign = "left";
        if (s.banner.life <= 0) s.banner = null;
      }

      // HUD · painted on the canvas so no HTML row can overflow a phone.
      if (phaseRef.current !== "intro") {
        ctx.textAlign = "left";
        ctx.font = "700 14px ui-monospace, monospace";
        ctx.fillStyle = "#FFD9A0";
        ctx.fillText(`HEIGHT ${s.height}`, 14, 26);
        ctx.font = "600 11px ui-monospace, monospace";
        ctx.fillStyle = "rgba(235,225,210,0.55)";
        ctx.fillText(`reward ₿${subsidyFor(s.height)}`, 14, 44);
        ctx.textAlign = "right";
        ctx.font = "700 14px ui-monospace, monospace";
        ctx.fillStyle = "#F7931A";
        ctx.fillText(`${s.sats.toLocaleString("en-US")} sats`, cw - 14, 26);
        if (s.streak >= 2) {
          ctx.font = "600 11px ui-monospace, monospace";
          ctx.fillStyle = "#31C48D";
          ctx.fillText(
            `perfect ×${s.streak} · combo ${comboFor(s.streak).toFixed(2)}×`,
            cw - 14,
            44,
          );
        }
        ctx.textAlign = "left";
      }

      // Test hook · same pattern as the globe + the old arena.
      (window as unknown as Record<string, unknown>).__gmTimechain = {
        curX: s.curX,
        curW: s.curW,
        topX: s.blocks.length ? s.blocks[s.blocks.length - 1].x : (cw - s.curW) / 2,
        topW: s.blocks.length ? s.blocks[s.blocks.length - 1].w : s.curW,
        height: s.height,
        phase: phaseRef.current,
      };

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Keyboard · Space/Enter drops (house guard shape · never steal keys
  // from form fields or modified shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        if (phaseRef.current === "running") {
          e.preventDefault();
          drop();
        } else if (phaseRef.current === "dead") {
          e.preventDefault();
          if (performance.now() - diedAtRef.current < 600) return;
          start();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drop, start]);

  function shareHref(): string {
    if (!death) return "https://x.com/intent/tweet";
    const handle = getHandle();
    const rankLine =
      deathRank != null ? `\n#${deathRank} on the all-time board` : "";
    const text = `Timechain · ${handle} stacked the chain to height ${death.height} · ${death.sats.toLocaleString("en-US")} sats banked before it orphaned.${rankLine}\n\nBuild the timechain: galaxymind.space/horizon`;
    return "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          if (phaseRef.current !== "running") return;
          tapRef.current = {
            x: e.clientX,
            y: e.clientY,
            t: performance.now(),
            curX: g.current.curX,
          };
        }}
        onPointerUp={(e) => {
          const tap = tapRef.current;
          tapRef.current = null;
          if (!tap || phaseRef.current !== "running") return;
          // A vertical swipe is a SCROLL, not a drop · pan-y lets the
          // page move and this slop check keeps the block unspent. The
          // drop scores the pointerDOWN-time position, so the ~80ms tap
          // duration never penalizes timing.
          if (
            Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12 ||
            performance.now() - tap.t > 350
          ) {
            return;
          }
          drop(tap.curX);
        }}
        onPointerCancel={() => {
          tapRef.current = null;
        }}
        className="block h-[460px] w-full [touch-action:pan-y] select-none cursor-pointer sm:h-[520px]"
        role="img"
        aria-label="Timechain · a one-tap block stacker. Tap, click, or press space to drop the sliding block onto the chain. Every 21 blocks the reward halves and the chain speeds up."
      />

      {/* Intro overlay */}
      {phase === "intro" && (
        <div
          className="absolute inset-0 z-10 flex touch-manipulation items-center justify-center"
          style={{ background: "rgba(8,8,11,0.9)" }}
        >
          <div className="max-w-md px-6 text-center">
            <div
              className="micro-label mb-2"
              style={{ color: "var(--accent)" }}
            >
              Timechain
            </div>
            <p
              className="mb-1 text-sm leading-relaxed"
              style={{ color: "rgba(235,225,210,0.66)" }}
            >
              Tap to drop the sliding block on the chain. Clean drops keep
              their width · overhang gets sliced off. Every 21 blocks the
              reward halves and the chain speeds up.
            </p>
            {best && (
              <p
                className="micro-label mb-4"
                style={{ color: "rgba(235,225,210,0.55)" }}
              >
                Best · height {best.h} · {best.s.toLocaleString("en-US")} sats
              </p>
            )}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={start}
                className="rounded-lg bg-[var(--accent)] px-7 py-3 font-mono text-sm font-bold uppercase tracking-[0.22em] text-black transition-all hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)]"
              >
                Stack →
              </button>
              <button
                type="button"
                onClick={toggleAudio}
                aria-pressed={audioOn}
                className="micro-label rounded-lg border px-4 py-3 transition-all hover:border-[var(--accent)]"
                style={{
                  borderColor: audioOn
                    ? "rgba(247,147,26,0.5)"
                    : "rgba(235,225,210,0.25)",
                  color: audioOn ? "var(--accent)" : "rgba(235,225,210,0.66)",
                }}
              >
                {audioOn ? "♪ Sound on" : "∅ Sound off"}
              </button>
            </div>
            {liveTipHeight > 0 && (
              <p
                className="mt-4 font-mono t-xs uppercase tracking-[0.2em]"
                style={{ color: "rgba(235,225,210,0.4)" }}
              >
                The live chain is at block {liveTipHeight.toLocaleString("en-US")} ·
                yours starts at zero
              </p>
            )}
          </div>
        </div>
      )}

      {/* Death overlay · the whole surface restarts, like the Runner. */}
      {phase === "dead" && death && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            // Grace window · near death the player is tapping fast; the
            // tap AFTER the miss must not restart before the score is
            // ever seen (mobile review 2026-07-09).
            if (performance.now() - diedAtRef.current < 600) return;
            start();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Stop here · the window listener also restarts on Enter,
              // and one keypress must not start() twice (review).
              e.stopPropagation();
              if (performance.now() - diedAtRef.current < 600) return;
              start();
            }
          }}
          className="absolute inset-0 z-10 flex w-full cursor-pointer touch-manipulation items-center justify-center"
          style={{ background: "rgba(6,4,2,0.88)" }}
          aria-label="Stack it again"
        >
          <div className="pointer-events-none max-w-md px-6 text-center">
            <div
              className="g2-stamp mb-3 inline-block rounded-lg border-2 px-5 py-2 font-mono text-xl font-bold tracking-[0.15em] sm:text-2xl"
              style={{
                color: "#ff3a4f",
                borderColor: "#ff3a4f",
                textShadow: "0 0 18px #ff3a4f",
              }}
            >
              CHAIN ORPHANED
            </div>
            <div
              className="mb-1 font-mono text-lg tabular-nums"
              style={{ color: "#F2EFE9" }}
            >
              height {death.height} · {death.sats.toLocaleString("en-US")} sats
              {death.isBest && (
                <span
                  className="ml-2 t-xs uppercase tracking-widest"
                  style={{ color: "var(--accent)" }}
                >
                  · new best
                </span>
              )}
            </div>
            <div
              className="micro-label mb-3"
              style={{ color: "rgba(235,225,210,0.55)" }}
            >
              you died in the ₿{death.epochSubsidy} reward era
            </div>
            <div
              className="micro-label mb-3"
              style={{ color: "var(--accent)" }}
            >
              played as {getHandle()}
              {deathRank != null
                ? ` · #${deathRank} on the all-time board`
                : ""}
            </div>
            <div
              className="mb-4 font-mono t-xs uppercase tracking-[0.25em]"
              style={{ color: "rgba(235,225,210,0.45)" }}
            >
              or tap anywhere to stack again
            </div>
            <span
              className="pointer-events-auto flex flex-wrap justify-center gap-2"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  start();
                }}
                className="micro-label rounded-lg bg-[var(--accent)] px-6 py-3 font-bold text-black transition-all hover:bg-[var(--accent-hover)] hover:shadow-[0_0_24px_var(--accent-glow)]"
              >
                Try again →
              </button>
              <a
                href={shareHref()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  track("timechain_share");
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="micro-label rounded-lg bg-[var(--accent)] px-5 py-3 font-semibold text-black transition-all hover:bg-[var(--accent-hover)]"
              >
                Post it →
              </a>
              <a
                href="/arcade"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="micro-label inline-flex items-center rounded-lg border px-5 py-3 transition-all hover:border-[var(--accent)]"
                style={{
                  borderColor: "rgba(235,225,210,0.25)",
                  color: "#F2EFE9",
                }}
              >
                More games
              </a>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
