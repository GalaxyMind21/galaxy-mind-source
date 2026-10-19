// OG card for /wen · a redacted mystery chart and the dare. A jagged
// line silhouette (deterministic · Satori doesn't need the real series
// to sell the idea) with the date axis blacked out. Static per deploy.
// ASCII-safe text only (the documented next/og glyph-fetch failure).

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "WEN · guess when the bitcoin chart happened · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

// A suggestive 90-day-ish squiggle · run-up, dump, chop, recovery.
const BARS = [
  70, 84, 96, 118, 140, 128, 96, 64, 48, 42, 56, 68, 60, 74, 92, 86,
  102, 96, 116, 128, 122,
];

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          backgroundImage: LAMP,
          color: FG,
          padding: "56px 64px 48px",
          fontFamily: SANS,
          position: "relative",
        }}
      >
        {/* Mystery chart silhouette */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 90,
            display: "flex",
            alignItems: "flex-end",
            gap: 10,
            padding: "0 64px",
            opacity: 0.5,
          }}
        >
          {BARS.map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 42,
                height: h,
                background: i % 3 === 0 ? ACCENT : "#3a2c18",
                borderRadius: 4,
              }}
            />
          ))}
        </div>
        {/* Redacted date axis */}
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            bottom: 44,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 26,
            color: FG_MUTED,
            letterSpacing: 5.2,
          }}
        >
          <span>####</span>
          <span>####</span>
          <span>####</span>
          <span>####</span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 26,
            letterSpacing: 5.2,
            color: "#F2EFE9",
          }}
        >
          THE ARCADE - DAILY PUZZLE
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 120,
            fontWeight: 500,
            marginTop: 8,
            letterSpacing: -3.6,
          }}
        >
          WEN
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 40,
            color: FG,
            marginTop: 4,
            maxWidth: 900,
          }}
        >
          A genuine bitcoin chart. Dates redacted. Five guesses.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: FG_MUTED,
            marginTop: 14,
          }}
        >
          Same tape for everyone, every day - scored in sats -
          galaxymind.space/wen
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
