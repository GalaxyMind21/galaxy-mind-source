// src/app/manifest.ts · Web App Manifest for PWA / "Add to Home
// Screen" on iOS + Android.
//
// Next 14+ honors this file path as the web app manifest endpoint
// (served at /manifest.webmanifest). Browsers pick it up via the
// <link rel="manifest"> tag that Next auto-injects when this file
// exists.
//
// `display: standalone` is the key field · it makes iOS / Android
// launch the site without browser chrome (no URL bar, no tabs)
// when opened from the home screen icon. The site feels like a
// real app, which dramatically lifts return-visit rates for
// mobile-heavy traffic (~71% of our visitors).
//
// Icons reference the dynamic icon.tsx and apple-icon.tsx files
// in this same directory · they rasterize public/brand/galaxy-pin.png.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Galaxy Mind",
    short_name: "Galaxy Mind",
    description:
      "Bitcoin tools · vendor directory · Buying Gauge · float tracker · treasury scoreboard.",
    // Habit home · installed PWA should open the daily briefing, not
    // the vendor directory (product priority 2026-07-10).
    start_url: "/today?src=pwa",
    display: "standalone",
    background_color: "#12110F",
    theme_color: "#F7931A",
    orientation: "portrait",
    // Chromium installability requires a ≥192px icon (512 for the
    // splash screen) — icon.tsx emits all three sizes via
    // generateImageMetadata at /icon/<size> (audit 2026-07-12).
    icons: [
      {
        src: "/icon/32",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
