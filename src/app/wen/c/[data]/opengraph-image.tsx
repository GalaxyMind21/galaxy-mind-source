// Dynamic OG billboard for a shared WEN result (/wen/c/<seg>). The
// guess grid renders as DRAWN chevrons + colored squares, never emoji
// text · this is a dynamic nodejs OG route and next/og's on-demand
// glyph fetch for non-ASCII is a documented hard 500 (see
// /api/og/stack). Every value comes through decodeWenCard's clamps.

import { ImageResponse } from "next/og";
import { decodeWenCard, type WenCardCell } from "@/lib/wen";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "A WEN result · the daily bitcoin chart-dating game";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// A given data segment renders deterministically · let the CDN absorb
// unfurler re-scrapes and garbage-segment floods instead of paying the
// Satori render each time (audit 2026-07-11 · the /api/og/stack lesson;
// per-IP limiting is impossible in the opengraph-image convention, the
// 24h per-URL cache is the available layer).
export const revalidate = 86400;

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

const BAND_COLOR: Record<string, string> = {
  close: "#EAB308",
  warm: "#F97316",
  cold: "#EF4444",
  ice: "rgba(247, 238, 224, 0.085)",
};

function CellBox({ cell }: { cell: WenCardCell }) {
  if (cell.band === "bull") {
    // Bullseye · concentric rings.
    return (
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          border: `10px solid ${ACCENT}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            background: ACCENT,
            display: "flex",
          }}
        />
      </div>
    );
  }
  const chevron = cell.direction === "earlier" ? "<<" : ">>";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          display: "flex",
          fontSize: 44,
          fontWeight: 500,
          color: FG_MUTED,
          fontFamily: SANS,
        }}
      >
        {chevron}
      </div>
      <div
        style={{
          width: 74,
          height: 74,
          borderRadius: 14,
          background: BAND_COLOR[cell.band] ?? "rgba(247, 238, 224, 0.085)",
          display: "flex",
        }}
      />
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const card = decodeWenCard(data);
  const sats = card?.sats ?? 0;
  const n = card?.n ?? 0;
  const cells = card?.cells ?? [];

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
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 5.2, color: ACCENT }}>
            {n > 0 ? `WEN #${n}` : "WEN"}
          </div>
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 4, color: FG_MUTED }}>
            GALAXY MIND
          </div>
        </div>

        {card ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 150,
                  fontWeight: 500,
                  color: ACCENT,
                  lineHeight: 1,
                }}
              >
                {sats.toLocaleString("en-US")}
              </div>
              <div style={{ display: "flex", fontSize: 54, color: FG }}>sats</div>
            </div>
            {cells.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 30,
                  marginTop: 44,
                }}
              >
                {cells.map((c, i) => (
                  <CellBox key={i} cell={c} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              fontSize: 64,
              maxWidth: 900,
            }}
          >
            A genuine bitcoin chart. Dates redacted. Five guesses.
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 26,
            color: FG_MUTED,
          }}
        >
          <div style={{ display: "flex" }}>
            Dated a redacted slice of the actual bitcoin tape
          </div>
          <div style={{ display: "flex", color: FG }}>galaxymind.space/wen</div>
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
