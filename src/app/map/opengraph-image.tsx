// OG card for /map · "Online shops, by country". A dot
// constellation motif (deterministic pseudo-grid, not the real
// projection · Satori doesn't need cartography to sell the idea) +
// live shop/country counts. Static per deploy: the counts come
// from the bundled VENDORS roster, which only changes on deploy.

import { ImageResponse } from "next/og";
import { VENDORS } from "@/lib/vendors";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "Online shops, by country · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const FG_DIM = "#948F84";

const DOTS: { x: number; y: number; r: number }[] = [
  { x: 195, y: 250, r: 26 }, { x: 250, y: 320, r: 10 }, { x: 300, y: 410, r: 8 },
  { x: 245, y: 190, r: 12 }, { x: 340, y: 460, r: 7 },
  { x: 555, y: 195, r: 16 }, { x: 585, y: 240, r: 11 }, { x: 610, y: 205, r: 9 },
  { x: 630, y: 260, r: 8 }, { x: 560, y: 290, r: 7 }, { x: 525, y: 235, r: 9 },
  { x: 660, y: 430, r: 9 }, { x: 880, y: 300, r: 10 }, { x: 940, y: 420, r: 12 },
  { x: 1010, y: 465, r: 8 }, { x: 850, y: 220, r: 7 },
];

export default async function Image() {
  const countryCount = new Set(
    VENDORS.map((v) => v.country).filter(Boolean),
  ).size;
  const mappedCount = VENDORS.filter((v) => v.country).length;

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
          padding: "48px 56px",
          fontFamily: SANS,
          position: "relative",
        }}
      >
        {DOTS.map((d, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              position: "absolute",
              left: d.x - d.r,
              top: d.y - d.r,
              width: d.r * 2,
              height: d.r * 2,
              borderRadius: 999,
              background: ACCENT,
              opacity: 0.85,
              boxShadow: `0 0 ${d.r * 2.4}px rgba(247,147,26,0.55)`,
            }}
          />
        ))}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "0.2em",
            }}
          >
            <span>GALAXY</span>
            <span style={{ marginLeft: 12 }}>MIND</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 18,
              letterSpacing: "0.2em",
              color: FG_DIM,
              textTransform: "uppercase",
            }}
          >
            By country
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "auto",
          }}
        >
          <div style={{ display: "flex", fontSize: 62, fontWeight: 500 }}>
            Online shops, by country.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: FG_MUTED,
              marginTop: 14,
            }}
          >
            {mappedCount} listed online shops · {countryCount} countries ·
            native bitcoin
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              color: FG_DIM,
              marginTop: 26,
              letterSpacing: "0.08em",
            }}
          >
            galaxymind.space/map
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
