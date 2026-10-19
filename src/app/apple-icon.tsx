// src/app/apple-icon.tsx · iOS home-screen icon (180×180 PNG)
//
// Same Imagine enamel-pin as icon.tsx, night square (iOS masks it).
// Master: Desktop/Galaxy-Mind-Brand/01-logo-imagine-crop.png

import { ImageResponse } from "next/og";
import { GALAXY_PIN_NIGHT, galaxyPinDataUrl } from "@/lib/galaxy-pin-data";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const inner = Math.round(180 * 0.92);
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: GALAXY_PIN_NIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={galaxyPinDataUrl()} width={inner} height={inner} alt="" />
      </div>
    ),
    size,
  );
}
