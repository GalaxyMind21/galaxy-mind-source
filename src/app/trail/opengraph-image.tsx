// OG card for /trail · a wagon-track of era markers ending at the
// citadel, with a tombstone beat mid-route (the share hook). Static
// per deploy. ASCII-safe text only (the documented next/og glyph
// fetch failure) · glyph art is drawn with boxes, not emoji.

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt =
  "THE HODL TRAIL · survive 15 years of bitcoin history · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

// The route · ten era stops, one loss, a citadel. Pure decoration.
const STOPS = [
  { y: 44, lost: false },
  { y: 30, lost: false },
  { y: 58, lost: false },
  { y: 20, lost: false },
  { y: 66, lost: true },
  { y: 38, lost: false },
  { y: 74, lost: false },
  { y: 26, lost: false },
  { y: 52, lost: false },
  { y: 12, lost: false },
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
        {/* The trail line */}
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            bottom: 150,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          {STOPS.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26 + s.y,
                  borderRadius: 6,
                  background: s.lost ? "#3a1515" : "#2a2013",
                  border: s.lost
                    ? "2px solid #7f1d1d"
                    : `2px solid ${i >= 8 ? ACCENT : "#4a3018"}`,
                  display: "flex",
                }}
              />
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 10,
                  background: s.lost ? "#7f1d1d" : ACCENT,
                  display: "flex",
                }}
              />
            </div>
          ))}
        </div>

        <div
          style={{
            fontSize: 26,
            letterSpacing: 5.2,
            color: FG_MUTED,
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          Galaxy Mind Arcade · Daily Expedition
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 92,
            fontWeight: 500,
            letterSpacing: -2.8,
            display: "flex",
          }}
        >
          THE&nbsp;
          <span style={{ color: ACCENT }}>HODL</span>
          &nbsp;TRAIL
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 34,
            color: FG_MUTED,
            display: "flex",
          }}
        >
          Four plebs. Fifteen years of bitcoin history. One stack.
        </div>

        <div
          style={{
            position: "absolute",
            left: 64,
            bottom: 48,
            fontSize: 26,
            color: FG_MUTED,
            display: "flex",
          }}
        >
          One expedition a day · scored in sats · replay-verified board
        </div>
        <div
          style={{
            position: "absolute",
            right: 64,
            bottom: 48,
            fontSize: 28,
            color: ACCENT,
            display: "flex",
          }}
        >
          galaxymind.space/trail
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
