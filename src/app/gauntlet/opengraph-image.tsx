// OG card for /gauntlet · a dark arcade marquee. A jagged bar-chart
// silhouette (deterministic, suggestive of the 2021-2026 tape · Satori
// doesn't need the real series to sell the idea), a representative
// spread of the real ending tiers (see tierFor in engine.ts), and the
// dare. Static per deploy · keep the tier chips in sync with tierFor.

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt =
  "The Bitcoin Gauntlet · trade eight months of hidden bitcoin history blind against a DCA bot · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

// Rough silhouette of the 2021→2026 arc: top, long bear, recovery,
// ETF leg, chop. Heights in px of a 160px lane.
const BARS = [
  92, 118, 148, 132, 104, 78, 56, 44, 38, 52, 64, 72, 86, 108, 128,
  142, 126, 138, 152, 144, 156,
];

// A representative spread of the real ending tiers · strings and tones
// mirror tierFor() in engine.ts, with CSS vars resolved to their
// dark-theme hex (Satori can't read custom properties). BOT SLAYER is
// the whole point of the game: beat the DCA bot. Keep in sync with
// tierFor · REKT / ORACLE / BOT SLAYER / STEADY HANDS / SHAKEN / OUTTRADED.
const TIERS = [
  { label: "ORACLE", color: "#31C48D" },
  { label: "BOT SLAYER", color: "#4ADE80" },
  { label: "STEADY HANDS", color: ACCENT },
  { label: "REKT", color: "#ff3a4f" },
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
        {/* Chart silhouette · anchored to the bottom like a tape */}
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
            opacity: 0.22,
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
          Galaxy Mind · The Arcade
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 34,
          }}
        >
          <div style={{ display: "flex", fontSize: 84, fontWeight: 500 }}>
            The Bitcoin Gauntlet
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              color: FG_MUTED,
              marginTop: 16,
            }}
          >
            Eight months blind · actual prices, hidden dates, then the reveal
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 18,
            marginTop: 52,
          }}
        >
          {TIERS.map((t) => (
            <div
              key={t.label}
              style={{
                display: "flex",
                padding: "12px 22px",
                border: `3px solid ${t.color}`,
                borderRadius: 10,
                color: t.color,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 3,
                transform: "rotate(-2deg)",
              }}
            >
              {t.label}
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
          Beat the bot that never thinks · galaxymind.space/gauntlet
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
