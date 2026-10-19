"use client";

/* =====================================================================
 * SpotPriceNumber · unit-aware price figure (USD ↔ sats per dollar)
 *
 * The interactive leaf under BtcSpotPriceHero. The hero itself is
 * deliberately server-pure (it renders inside streamed RSC passes ·
 * see its header comment), so the only part that needs client state ·
 * the unit toggle · is isolated here. Clicking the figure flips the
 * sitewide unit pref (lib/unit-pref.ts); every other consumer follows
 * via the shared store.
 *
 * Sats mode shows "Moscow time" · sats per one US dollar · the
 * denominator this audience actually thinks in. SSR always renders
 * USD (server can't know the pref) and useSyncExternalStore swaps in
 * the stored pref at hydration without a mismatch error.
 * ===================================================================== */

import { satsPerDollar, toggleUnitPref, useUnitPref } from "@/lib/unit-pref";

export function SpotPriceNumber({
  price,
  className,
}: {
  price: number;
  /** Font/size classes from the server parent · keeps every size
   *  variant's class literals in the parent for Tailwind's scanner. */
  className: string;
}) {
  const unit = useUnitPref();
  const label =
    unit === "sats"
      ? `${satsPerDollar(price).toLocaleString("en-US")} sats/$`
      : `$${Math.round(price).toLocaleString("en-US")}`;
  return (
    <button
      type="button"
      onClick={toggleUnitPref}
      title={
        unit === "sats"
          ? "Sats per dollar · click for USD"
          : "Click to flip to sats per dollar"
      }
      aria-label={`BTC price display, currently in ${unit === "sats" ? "sats per dollar" : "US dollars"}. Click to switch units.`}
      className={`${className} appearance-none bg-transparent p-0 border-0 cursor-pointer select-none`}
    >
      {label}
    </button>
  );
}
