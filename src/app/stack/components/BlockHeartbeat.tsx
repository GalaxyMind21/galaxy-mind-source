"use client";
import { useEffect, useRef, useState } from "react";
import { metalTap } from "@/lib/audio-synth";
import { haptic } from "@/lib/haptics";

/**
 * Polls /api/heartbeat every 30s for the latest block height + Buying Gauge
 * verdict. When a new block is detected, pulses the wrapped children with
 * a brief inset glow.
 *
 * Heartbeat color depends on the live score:
 *   • MOLTEN tier (score >= 81) → deep red pulse — the page literally
 *     bleeds with each new block ("blood in the streets")
 *   • everything else → bitcoin-orange pulse
 * The `degraded` flag from the heartbeat (≥4 of 8 market signals null)
 * forces the pulse off so visual effects don't trigger on placeholder data.
 *
 * Switched from polling /api/market (~430 KB) to /api/heartbeat (~120 B)
 * — same poll cadence, ~98% bandwidth reduction.
 *
 * AUDIO + HAPTIC (May 2026)
 * ─────────────────────────
 * When the visitor has enabled sound on /stack (LS key
 * gm:gauge:soundEnabled), each detected new block fires:
 *   - A brass metalTap() at 1100Hz · subtle, like a vintage instrument
 *     ticking with the network's heartbeat. ~10 min between blocks
 *     (Bitcoin's average block time) so the cadence is meditative,
 *     not annoying.
 *   - A 5ms haptic pulse on supported devices.
 *
 * Cross-component sound-state coupling: we read the PressureGauge's
 * LS key directly here · simpler than lifting state up, fast enough
 * (synchronous LS read) for once-per-10-min usage. The AudioContext
 * is created lazily on the first block so we don't burn one if the
 * page is never visited long enough to see a block.
 */
export function BlockHeartbeat({ children }: { children: React.ReactNode }) {
  const [pulse, setPulse] = useState(false);
  const [molten, setMolten] = useState(false);
  // AudioContext lazy-init on first use · gesture is implicit (the
  // visitor enabled sound elsewhere on the page, which itself was
  // a gesture). Never created if sound stays disabled.
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    let prev = 0;

    function isSoundEnabled(): boolean {
      try {
        return localStorage.getItem("gm:gauge:soundEnabled") === "1";
      } catch {
        return false;
      }
    }

    function ensureCtx(): { ctx: AudioContext; master: GainNode } | null {
      if (ctxRef.current && masterRef.current) {
        return { ctx: ctxRef.current, master: masterRef.current };
      }
      if (typeof window === "undefined") return null;
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      ctxRef.current = ctx;
      masterRef.current = master;
      return { ctx, master };
    }

    async function tick() {
      try {
        const r = await fetch("/api/heartbeat");
        if (!r.ok) return;
        const j = await r.json();
        const h = typeof j.blockHeight === "number" ? j.blockHeight : null;
        if (cancelled || h == null) return;
        if (prev !== 0 && h !== prev) {
          setPulse(true);
          setTimeout(() => setPulse(false), 800);
          // Audio + haptic block tick · only fires when sound is
          // enabled. Audible "the network just minted a block."
          if (isSoundEnabled()) {
            const audio = ensureCtx();
            if (audio) {
              audio.ctx.resume().catch(() => {});
              metalTap(audio, audio.ctx.currentTime, 1100, 0.35);
              haptic("needleTick", true);
            }
          }
        }
        prev = h;
        if (j.degraded) {
          setMolten(false);
        } else if (typeof j.score === "number") {
          setMolten(j.score >= 81);
        }
      } catch {
        // swallow
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      masterRef.current = null;
    };
  }, []);

  const pulseGlow = molten
    ? "inset 0 0 160px 0 rgba(220, 38, 38, 0.10)"
    : "inset 0 0 120px 0 rgba(247,147,26,0.06)";

  return (
    <div
      className="transition-shadow duration-700"
      style={{
        boxShadow: pulse ? pulseGlow : "inset 0 0 0 0 rgba(247,147,26,0)",
      }}
    >
      {children}
    </div>
  );
}
