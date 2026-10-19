// OG card for /arcade · the marquee over all five cabinets. One title,
// five game chips (keep in sync with CABINETS in page.tsx), and the
// shared premise: everything runs on the real tape. Static per deploy.
// ASCII-safe text only (the documented next/og glyph-fetch failure).

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt =
  "The Arcade · five bitcoin games on the actual price tape · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

// One chip per cabinet · order mirrors CABINETS in page.tsx (flagship
// first). The flagship chip gets the loud treatment.
const CABINETS = [
  { label: "SUPER SAYLOR", loud: true },
  { label: "WEN", loud: false },
  { label: "GAUNTLET", loud: false },
  { label: "NODE RUNNER", loud: false },
  { label: "TIMECHAIN", loud: false },
];

// Faint tape silhouette along the floor · same trick as /gauntlet's
// card (Satori doesn't need the real series to sell the idea).
const BARS = [
  60, 78, 96, 120, 108, 84, 62, 48, 42, 58, 72, 88, 104, 96, 118, 132,
  120, 136, 148, 140, 156,
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
        {/* Tape silhouette floor */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "flex-end",
            gap: 14,
            padding: "0 40px",
            opacity: 0.18,
          }}
        >
          {BARS.map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 42,
                height: h,
                background:
                  i === BARS.length - 1 ? ACCENT : "rgba(247,147,26,0.7)",
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 26,
            letterSpacing: 5.2,
            color: FG_MUTED,
            textTransform: "uppercase",
          }}
        >
          Galaxy Mind
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", marginTop: 30 }}
        >
          <div style={{ display: "flex", fontSize: 100, fontWeight: 500 }}>
            The Arcade
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              color: FG_MUTED,
              marginTop: 14,
            }}
          >
            Five bitcoin games, one door - built on the bitcoin story
          </div>
        </div>

        {/* Cabinet marquee chips */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            marginTop: 48,
            maxWidth: 1000,
          }}
        >
          {CABINETS.map((c) => (
            <div
              key={c.label}
              style={{
                display: "flex",
                padding: "12px 22px",
                border: `3px solid ${c.loud ? ACCENT : "rgba(247,147,26,0.45)"}`,
                borderRadius: 10,
                color: c.loud ? ACCENT : FG,
                fontSize: 25,
                fontWeight: 700,
                letterSpacing: 3,
                // Satori can't parse `transform: none` · only set the
                // property when there's a real transform to apply.
                ...(c.loud ? { transform: "rotate(-2deg)" } : {}),
              }}
            >
              {c.label}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            fontSize: 28,
            color: ACCENT,
            fontWeight: 700,
          }}
        >
          Nothing here is generated - galaxymind.space/arcade
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
