// src/app/icon.tsx · browser-tab favicon (32×32 PNG served at /icon)
//
// Brand mark: Imagine enamel-pin galaxy on a night tile.
// Keep in sync with apple-icon.tsx.
// Master: Desktop/Galaxy-Mind-Brand/01-logo-imagine-crop.png

import { ImageResponse } from "next/og";
import { GALAXY_PIN_NIGHT, galaxyPinDataUrl } from "@/lib/galaxy-pin-data";

export const runtime = "nodejs";

// Multi-size: one file emits the browser-tab favicon AND the PWA
// install icons. Chromium's installability criteria require a
// ≥192px manifest icon (512px recommended for splash) — without
// these the manifest's whole purpose (installing /today as the
// daily-habit app) silently never triggers (audit 2026-07-12).
// manifest.ts references the generated /icon/<id> URLs — keep ids
// numeric (= pixel size) and the two files in sync.
const SIZES = [32, 192, 512] as const;

export function generateImageMetadata() {
  return SIZES.map((s) => ({
    id: String(s),
    size: { width: s, height: s },
    contentType: "image/png",
    alt: "Galaxy Mind",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const dim = Number(await id) || 32;
  const inner = Math.round(dim * 0.92);
  const src = galaxyPinDataUrl();
  return new ImageResponse(
    (
      <div
        style={{
          width: dim,
          height: dim,
          background: GALAXY_PIN_NIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={inner} height={inner} alt="" />
      </div>
    ),
    { width: dim, height: dim },
  );
}
