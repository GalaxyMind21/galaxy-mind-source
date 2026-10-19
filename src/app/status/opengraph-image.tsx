// OG card for /status · the data-health page. Deterministic source
// rows with green dots (no live data · the page's pitch is the honesty
// of the practice, not a frozen reading). Static per deploy.
// ASCII-safe text only (the documented next/og glyph-fetch failure).

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt =
  "System Status · live health of every Galaxy Mind data source";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const OK = "#4ADE80";

// Representative source rows · mirrors the page's sections, not a
// snapshot of them (the card must never claim a live reading).
const ROWS = [
  "Market signals",
  "Treasury mNAV",
  "Bitcoin float",
  "Vendor freshness",
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
        }}
      >
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
          style={{ display: "flex", flexDirection: "column", marginTop: 34 }}
        >
          <div style={{ display: "flex", fontSize: 88, fontWeight: 500 }}>
            System Status
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              color: FG_MUTED,
              marginTop: 14,
              maxWidth: 860,
            }}
          >
            Live or running on fallbacks - every data source, stated plainly
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 46,
            gap: 16,
          }}
        >
          {ROWS.map((label) => (
            <div
              key={label}
              style={{ display: "flex", alignItems: "center", gap: 18 }}
            >
              <div
                style={{
                  display: "flex",
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: OK,
                }}
              />
              <div style={{ display: "flex", fontSize: 30, color: FG }}>
                {label}
              </div>
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
          galaxymind.space/status
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
