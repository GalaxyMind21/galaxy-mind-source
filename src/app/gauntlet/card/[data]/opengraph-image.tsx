// Per-run share card image for a finished Bitcoin Gauntlet run, rendered
// on demand from the run encoded in the path segment (lib/run-card). This
// is what X unfurls when a player shares their result. Every value is
// already clamped by decodeGauntletCard; a malformed segment falls back.

import { ImageResponse } from "next/og";
import { decodeGauntletCard } from "@/lib/run-card";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "A Bitcoin Gauntlet result · Galaxy Mind";
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
const GREEN = "#31C48D";
const RED = "#ff3a4f";

// A jagged trading-chart silhouette (suggestive, not the real window).
const BARS = [
  70, 96, 120, 108, 132, 150, 120, 92, 66, 48, 62, 84, 104, 130, 116, 138, 156,
  140, 122, 146, 160,
];

function tierColor(tier: string): string {
  const t = tier.toUpperCase();
  if (t.includes("ORACLE")) return GREEN;
  if (t.includes("BOT SLAYER")) return "#4ADE80";
  if (t.includes("STEADY")) return ACCENT;
  if (t.includes("REKT")) return RED;
  if (t.includes("SHAKEN") || t.includes("OUTTRADED")) return "#FB923C";
  return ACCENT;
}

export default async function Image({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeGauntletCard(data);

  const alpha = run?.alpha ?? 0;
  const tier = run?.tier || "THE GAUNTLET";
  const num = run?.number ?? null;
  const rank = run?.rank ?? null;
  const handle = run?.handle ?? null;
  const liquidated = run?.liquidated ?? false;
  const beat = alpha >= 0;
  const alphaColor = beat ? GREEN : "#FB923C";
  const alphaStr = `${beat ? "+" : ""}${alpha.toFixed(1)}%`;

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
            opacity: 0.16,
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
            justifyContent: "space-between",
            alignItems: "baseline",
            fontSize: 24,
            letterSpacing: 4.8,
            color: FG_MUTED,
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex" }}>
            Galaxy Mind · The Bitcoin Gauntlet
          </div>
          {handle && (
            <div style={{ display: "flex", letterSpacing: 2, color: ACCENT }}>
              {handle}
            </div>
          )}
        </div>

        {/* Tier stamp */}
        <div
          style={{
            display: "flex",
            marginTop: 30,
            padding: "10px 26px",
            border: `4px solid ${tierColor(tier)}`,
            borderRadius: 12,
            color: tierColor(tier),
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: 4,
            alignSelf: "flex-start",
            transform: "rotate(-2deg)",
          }}
        >
          {tier}
        </div>

        {/* Big alpha */}
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 34 }}>
          <div
            style={{ display: "flex", fontSize: 140, fontWeight: 500, color: alphaColor }}
          >
            {alphaStr}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 42,
              color: FG_MUTED,
              marginLeft: 22,
            }}
          >
            vs the DCA bot
          </div>
        </div>

        {/* Sub row */}
        <div style={{ display: "flex", gap: 36, marginTop: 16, fontSize: 32 }}>
          <div style={{ display: "flex", color: FG_MUTED }}>
            {num != null ? `Gauntlet #${num}` : "practice run"}
          </div>
          {rank != null && (
            <div style={{ display: "flex", color: ACCENT, fontWeight: 700 }}>
              #{rank} today
            </div>
          )}
          {liquidated && (
            <div style={{ display: "flex", color: RED, fontWeight: 700 }}>
              liquidated
            </div>
          )}
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
          Eight months blind. Beat the bot that never thinks · galaxymind.space/gauntlet
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
