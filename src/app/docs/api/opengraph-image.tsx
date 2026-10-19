// OG card for /docs/api · the developer surface. A terminal-flavored
// curl line and the three format chips. Static per deploy.
// ASCII-safe text only (the documented next/og glyph-fetch failure).

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt =
  "Public API + MCP Server · free JSON, CSV, and SVG endpoints · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const ELEVATED = "#1C1A16";
const BORDER = "rgba(247, 238, 224, 0.085)";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

const FORMATS = ["JSON", "CSV", "SVG", "MCP"];

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
          <div style={{ display: "flex", fontSize: 84, fontWeight: 500 }}>
            Public API + MCP
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              color: FG_MUTED,
              marginTop: 14,
              maxWidth: 900,
            }}
          >
            The gauge, treasury mNAVs, the float, and the vendor directory -
            no auth, CORS-open
          </div>
        </div>

        {/* Terminal line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 46,
            padding: "22px 28px",
            background: ELEVATED,
            border: `2px solid ${BORDER}`,
            borderRadius: 12,
            fontSize: 30,
            fontFamily: SANS,
          }}
        >
          <span style={{ color: FG_MUTED, marginRight: 16 }}>$</span>
          <span style={{ color: FG }}>curl -s galaxymind.space/api/stack</span>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 32 }}>
          {FORMATS.map((f) => (
            <div
              key={f}
              style={{
                display: "flex",
                padding: "10px 20px",
                border: "3px solid rgba(247,147,26,0.45)",
                borderRadius: 10,
                color: ACCENT,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 4.8,
              }}
            >
              {f}
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
          galaxymind.space/docs/api
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
