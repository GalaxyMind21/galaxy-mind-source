"use client";

// Mobile-only inline BTC price element for the / page hero. Added
// 2026-05-21 audit-followup because the HeaderBtcPrice chip is
// hidden on the smallest mobile screens (header would crowd at
// 375px) but / has no other BTC price surface on mobile — every
// other page either has BtcSpotPriceHero (/stack, /float,
// /treasuries) or MarketStrip (/fit) carrying the number.
//
// Deliberately quiet · doesn't compete with the "Spend bitcoin"
// H1 or the HeroVendorPreview proof-of-content. Just an ambient
// mono line that says "BTC is currently $X." Click → /stack
// (where the price + verdict pair are the primary frame).
//
// sm:hidden · invisible on tablets and up where the HeaderBtcPrice
// chip is visible in the sticky header. No duplication.
//
// Same fetch-once-on-mount pattern as HeaderBtcPrice via slim
// /api/heartbeat (btcPrice only · no 24h delta without hourlies;
// price alone is enough for the quiet mobile hero line).

import { useEffect, useState } from "react";
import Link from "next/link";
import type { HeartbeatResponse } from "@/app/api/heartbeat/route";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; price: number }
  | { kind: "error" };

function formatPrice(p: number): string {
  return `$${Math.round(p).toLocaleString("en-US")}`;
}

export function HeroMobileBtcChip() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/heartbeat");
        if (!r.ok) {
          if (!cancelled) setState({ kind: "error" });
          return;
        }
        const data = (await r.json()) as HeartbeatResponse;
        if (cancelled) return;
        if (data.btcPrice == null || !Number.isFinite(data.btcPrice)) {
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "loaded", price: data.btcPrice });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Absent on loading and error · keeps the hero clean on the
  // first paint and on any KV / upstream blip. Returning users on
  // a warm cache get the number on first paint after the fetch
  // resolves (typically <300ms).
  if (state.kind !== "loaded") return null;

  return (
    <Link
      href="/stack?utm_source=home&utm_medium=hero_chip"
      title={`Bitcoin spot price: ${formatPrice(state.price)} · click to open the Buying Gauge`}
      className="sm:hidden inline-flex items-center gap-2 mt-3 font-mono t-xs tracking-wide text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse"
        aria-hidden
      />
      <span>BTC SPOT</span>
      <span aria-hidden>·</span>
      <span className="text-[var(--accent-ink)] font-semibold tabular-nums">
        {formatPrice(state.price)}
      </span>
    </Link>
  );
}
