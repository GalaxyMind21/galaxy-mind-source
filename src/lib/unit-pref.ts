// Sitewide display-unit preference · USD or sats. Bitcoiners think in
// sats ("Moscow time" · sats per dollar); a persisted toggle is an
// identity-level affordance for exactly this audience (2026-06-10).
//
// localStorage-backed (`gm_unit_pref`) with a useSyncExternalStore
// hook so every consumer (header chip + each BtcSpotPriceHero) flips
// together, including across tabs via the `storage` event. Same-tab
// consumers are nudged via a custom window event because `storage`
// only fires in OTHER tabs by spec.
//
// SSR snapshot is always "usd" · the server can't know the visitor's
// pref, and useSyncExternalStore re-renders with the client snapshot
// at hydration without a mismatch error (the React-sanctioned pattern
// for exactly this).

import { useSyncExternalStore } from "react";

const LS_KEY = "gm_unit_pref";
const EVT = "gm:unit-pref";

export type Unit = "usd" | "sats";

export function readUnitPref(): Unit {
  if (typeof window === "undefined") return "usd";
  try {
    return localStorage.getItem(LS_KEY) === "sats" ? "sats" : "usd";
  } catch {
    return "usd";
  }
}

export function toggleUnitPref(): void {
  try {
    localStorage.setItem(LS_KEY, readUnitPref() === "sats" ? "usd" : "sats");
  } catch {
    /* privacy mode · the toggle just won't persist */
  }
  window.dispatchEvent(new Event(EVT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useUnitPref(): Unit {
  return useSyncExternalStore(subscribe, readUnitPref, () => "usd" as Unit);
}

/** Moscow time · whole sats per one US dollar at the given BTC price. */
export function satsPerDollar(btcPrice: number): number {
  return Math.round(100_000_000 / btcPrice);
}
