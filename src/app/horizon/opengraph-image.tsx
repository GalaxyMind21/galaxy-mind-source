// OG card for /horizon · a rising block tower on the halving clock.
// Deterministic Satori scene (no live data): stacked blocks climbing
// toward the top-right, the reward-era chips (50 / 25 / 12.5 / 6.25),
// and the dare. Static per deploy. ASCII-safe text only (the
// documented next/og glyph-fetch failure).

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt =
  "Timechain · the one-tap block stacker on the halving clock · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

// Block tower silhouette · widths shrink as the chain climbs, the way
// a stacker run tightens. The last (topmost-drawn, leftmost) block is
// the lit "live" one.
const BLOCKS = [220, 208, 190, 186, 170, 152, 148, 128, 112, 96];

// Reward eras · halving subsidy chips, mirrors the in-game payouts.
const ERAS = ["50", "25", "12.5", "6.25"];

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
        {/* Block tower · anchored bottom-right like a mid-run stack */}
        <div
          style={{
            position: "absolute",
            right: 96,
            bottom: 0,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "center",
            gap: 8,
            opacity: 0.55,
          }}
        >
          {BLOCKS.map((w, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: w,
                height: 34,
                background:
                  i === BLOCKS.length - 1 ? ACCENT : "rgba(247,147,26,0.28)",
                border: `2px solid ${
                  i === BLOCKS.length - 1 ? ACCENT : "rgba(247,147,26,0.5)"
                }`,
                borderRadius: 6,
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
          Galaxy Mind - The Arcade
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", marginTop: 34 }}
        >
          <div style={{ display: "flex", fontSize: 96, fontWeight: 500 }}>
            Timechain
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              color: FG_MUTED,
              marginTop: 16,
              maxWidth: 700,
            }}
          >
            Stack the chain one tap at a time - every 21 blocks the reward
            halves and the game speeds up
          </div>
        </div>

        {/* Halving-era reward chips */}
        <div style={{ display: "flex", gap: 18, marginTop: 52 }}>
          {ERAS.map((r, i) => (
            <div
              key={r}
              style={{
                display: "flex",
                padding: "12px 22px",
                border: `3px solid ${i === 0 ? ACCENT : "rgba(247,147,26,0.45)"}`,
                borderRadius: 10,
                color: i === 0 ? ACCENT : FG_MUTED,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 2,
              }}
            >
              {r}
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
          Bank your sats before the orphan - galaxymind.space/horizon
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
