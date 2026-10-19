"use client";

/* =====================================================================
 * ArcadePreview · animated gameplay loop on the /arcade cabinet cards
 * (2026-07-12 · operator request: "show what each game looks like").
 *
 * Each cabinet ships a real-gameplay GIF recorded from the live game
 * (public/arcade-previews/<slug>.gif) plus a matching static poster
 * (<slug>.png). prefers-reduced-motion swaps the loop for the poster ·
 * six autoplaying GIFs is exactly the kind of motion that setting
 * exists to stop. GIFs are lazy-loaded; the fixed-height crop keeps
 * the mixed aspect ratios (landscape tapes, portrait Timechain) on one
 * clean card grid.
 *
 * Regenerate: the capture scripts live in the session notes · record
 * ~30 element-screenshot frames from real play, assemble with ffmpeg
 * palettegen/paletteuse at 9fps, 360-480px wide, under ~1MB each.
 *
 * bitcoin-kart (re-shot 2026-07-25 for the SHINE/cast-overhaul renderer):
 * the shot is the COUNTDOWN GRID THEATER, not a chase lap · that camera
 * sweeps the hero pose past the grid and back into the chase pose, so one
 * continuous take shows the unique chassis + faces big in frame and ends
 * on the launch. A plain chase lap reads as an empty road at 300px wide,
 * and the epic-air jumps shrink the kart to a speck. A moving camera
 * defeats GIF inter-frame delta, so the size budget comes from frame
 * count (26) + a 0.6px pre-blur that kills the sand/asphalt noise the
 * palette can't afford.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";

export function ArcadePreview({ slug, alt }: { slug: string; alt: string }) {
  const [reduced, setReduced] = useState(false);
  // in-view gate (UX audit 2026-07-13): the six cabinets' GIFs total
  // ~3.4MB and never pause (a GIF can't), so without gating all six
  // downloaded + kept animating off-screen on the 70%-mobile audience
  // over cellular. Now the GIF only mounts while the card is near the
  // viewport; the always-painted PNG poster (~50KB) covers the rest AND
  // the GIF's decode window, so there's no black box.
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      // preload/animate just before it scrolls in, stop just after out.
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const poster = `/arcade-previews/${slug}.png`;
  const gif = `/arcade-previews/${slug}.gif`;
  const playGif = !reduced && inView;

  return (
    <div
      ref={ref}
      className="relative mb-4 -mx-1 h-36 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black"
    >
      {/* Poster · always painted, so no black box before the GIF decodes
          and reduced-motion users get a clean still. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- posters are
          pre-sized crops; next/image adds no value on a fixed-height box */}
      <img
        src={poster}
        alt={alt}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-top opacity-90"
      />
      {/* Animated loop · only in the DOM while on-screen + motion allowed. */}
      {playGif && (
        // eslint-disable-next-line @next/next/no-img-element -- animated
        // GIF · next/image would re-encode the loop away
        <img
          src={gif}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover object-top opacity-90 transition-opacity group-hover:opacity-100"
        />
      )}
    </div>
  );
}
