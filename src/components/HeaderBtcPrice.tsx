"use client";

// Compact BTC price chip for the sticky SiteHeader · ambient context
// that follows the user across every page. Paired with the existing
// StickyScoreBar precedent on /stack ("price + verdict always
// visible after gauge scrolls out") · extends that idea so the
// price is ambient on every page, not just /stack.
//
// Fetches once on mount (no polling) via /api/heartbeat (~200 B with
// btcPrice) — NOT /api/market (~430 KB hourlies). Heartbeat KV-caches
// 60s; edge revalidate 30s. Ambient chip: minute-level staleness OK.
//
// Click navigates to /stack where the price + verdict pair is the
// page's primary frame. Hidden on the very smallest mobiles
// (< sm) to avoid crowding the existing nav cluster · most modern
// phones in portrait are >= 360px and clear the sm breakpoint at
// 640px when in landscape; the chip is always available via
// MobileBottomNav's /stack link.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { HeartbeatResponse } from "@/app/api/heartbeat/route";
import { satsPerDollar, useUnitPref } from "@/lib/unit-pref";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; price: number }
  | { kind: "error" };

function formatCompactPrice(price: number): string {
  // Header is space-constrained · use compact format (no commas,
  // abbreviated thousands above $10K). Examples:
  //   $9,876   → "$9,876"
  //   $112,847 → "$112K"
  //   $1.2M    → "$1.2M"
  if (price >= 1_000_000) {
    return `$${(price / 1_000_000).toFixed(2)}M`;
  }
  if (price >= 10_000) {
    return `$${Math.round(price / 1_000)}K`;
  }
  return `$${Math.round(price).toLocaleString("en-US")}`;
}

export function HeaderBtcPrice() {
  const [state, setState] = useState<State>({ kind: "loading" });
  // Follows the sitewide USD↔sats pref (toggled by clicking any
  // BtcSpotPriceHero figure) · the chip is a read-only mirror, the
  // click stays a nav to /stack.
  const unit = useUnitPref();

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
        if (data.btcPrice != null && Number.isFinite(data.btcPrice)) {
          setState({ kind: "loaded", price: data.btcPrice });
        } else {
          setState({ kind: "error" });
        }
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Don't reserve space on loading / error · the header layout
  // tolerates an absent chip and the loading state would be a
  // skeleton that flickers on every nav. A graceful absent state
  // is better than a flashing placeholder.
  if (state.kind !== "loaded") return null;

  const display =
    unit === "sats"
      ? `${satsPerDollar(state.price).toLocaleString("en-US")} sats/$`
      : formatCompactPrice(state.price);

  return (
    <Link
      href="/stack"
      title={`Bitcoin spot price: $${Math.round(state.price).toLocaleString("en-US")} · click to view the Buying Gauge`}
      className="hidden sm:inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md font-mono t-xs sm:text-xs tabular-nums text-[var(--accent-ink)] hover:bg-[var(--bg-elevated)]/60 transition-colors"
      aria-label={`Bitcoin spot price ${display} · go to Buying Gauge`}
    >
      <span aria-hidden>₿</span>
      <span className="font-semibold">{display}</span>
    </Link>
  );
}
