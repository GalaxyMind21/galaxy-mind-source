"use client";
import { useEffect, useState } from "react";

export function BlockHeightTicker() {
  const [height, setHeight] = useState<number | null>(null);
  const [ticked, setTicked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let prev = 0;
    async function tick() {
      try {
        // Polls /api/heartbeat (~120 B) instead of /api/market (~430 KB).
        const r = await fetch("/api/heartbeat");
        if (!r.ok) return;
        const j = await r.json();
        const h = typeof j.blockHeight === "number" ? j.blockHeight : null;
        if (cancelled || h == null) return;
        if (prev !== 0 && h !== prev) {
          setTicked(true);
          setTimeout(() => setTicked(false), 600);
        }
        prev = h;
        setHeight(h);
      } catch {
        // swallow
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (height == null) return null;
  return (
    <span
      className={`font-mono t-xs tracking-[0.2em] uppercase text-[var(--text-tertiary)] transition-colors ${ticked ? "text-[var(--accent-ink)]" : ""}`}
      title="Latest Bitcoin block height"
    >
      block #{height.toLocaleString()}
    </span>
  );
}
