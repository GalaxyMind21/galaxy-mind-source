// Per-run social billboard for a shared SUPER SAYLOR result
// (/super-saylor/c/<seg>). Three variants off the decoded card:
// a Daily Summit climb, a 21/21 campaign victory, or a run that ended.
// Deterministic Satori scene · no live data, ASCII-safe text only (the
// documented next/og glyph-fetch failure), system fonts, every element
// carries display:flex. Matches the horizon/runner game-card family.

import { ImageResponse } from "next/og";
import { decodeSaylorCard, fmtSummitMs } from "@/lib/saylor-card";
import { summitLevelFor } from "@/lib/gauntlet-day";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "A SUPER SAYLOR result · Galaxy Mind Arcade";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Per-URL CDN cache · deterministic per segment, absorbs unfurler
// re-scrapes and garbage-segment floods (per-IP limiting is impossible
// in the opengraph-image convention · the 24h cache is the only layer).
export const revalidate = 86400;

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const GREEN = "#4ADE80";

// Candle skyline silhouette · the game's own backdrop motif, drawn as
// a bottom-anchored bar row (Satori doesn't need the real series).
const SKYLINE = [
  70, 96, 132, 118, 88, 64, 52, 78, 104, 140, 126, 92, 68, 84, 112, 148, 130,
  102, 76, 94, 120,
];

function fmtN(n: number): string {
  return n.toLocaleString("en-US");
}

export default async function Image({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const card = decodeSaylorCard(data);
  const handle = card?.handle ?? "";

  // Per-variant hero content · all strings ASCII-safe (hyphens, no
  // middots or emoji · the safe choice for a dynamic OG route).
  let eyebrow = "Galaxy Mind - Super Saylor";
  let stamp: string | null = null;
  let stampColor = ACCENT;
  let bigText = "SUPER SAYLOR";
  let bigSub = "";
  let statRow: string[] = [];
  let cta = "Run bitcoin history one block at a time - galaxymind.space/super-saylor";

  if (card?.kind === "summit") {
    const lvl = summitLevelFor(card.day);
    eyebrow = `Galaxy Mind - Daily Summit #${card.day}`;
    bigText = fmtSummitMs(card.ms);
    bigSub = `Level ${lvl} climbed${handle ? " as " + handle : ""}`;
    cta =
      "Same mountain for everyone today - beat my climb - galaxymind.space/super-saylor";
  } else if (card?.kind === "victory") {
    stamp = "21 / 21 CLEARED";
    stampColor = GREEN;
    bigText = `${fmtN(card.sats)}`;
    bigSub = "sats banked on the full climb to the moon";
    statRow = [
      `${fmtN(card.bears)} bears orange-pilled`,
      `One Chair x${fmtN(card.convictions)}`,
    ];
    cta =
      "I beat Peter Schiff at the summit - play galaxymind.space/super-saylor";
  } else if (card?.kind === "run") {
    bigText = `${fmtN(card.sats)}`;
    bigSub = "sats banked";
    statRow = [
      `${card.levels}/21 levels`,
      `${fmtN(card.bears)} bears orange-pilled`,
    ];
    cta =
      "Outrun the bears through bitcoin history - galaxymind.space/super-saylor";
  } else {
    // Malformed segment · generic branded fallback.
    bigText = "SUPER SAYLOR";
    bigSub = "21 levels. 21 rules. One chair.";
    cta = "Run the whole bitcoin timeline - galaxymind.space/super-saylor";
  }

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
        {/* Candle skyline · anchored to the floor at low opacity */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "flex-end",
            gap: 14,
            padding: "0 44px",
            opacity: 0.16,
          }}
        >
          {SKYLINE.map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 42,
                height: h,
                background:
                  i === SKYLINE.length - 1 ? ACCENT : "rgba(247,147,26,0.7)",
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
          ))}
        </div>

        {/* Eyebrow + handle */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontSize: 25,
            letterSpacing: 5,
            color: FG_MUTED,
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex" }}>{eyebrow}</div>
          {handle ? (
            <div style={{ display: "flex", letterSpacing: 2, color: ACCENT }}>
              {handle}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
        </div>

        {/* Optional verdict stamp (victory) */}
        {stamp ? (
          <div
            style={{
              display: "flex",
              marginTop: 28,
              padding: "10px 26px",
              border: `4px solid ${stampColor}`,
              borderRadius: 12,
              color: stampColor,
              fontSize: 52,
              fontWeight: 800,
              letterSpacing: 4,
              alignSelf: "flex-start",
              transform: "rotate(-2deg)",
            }}
          >
            {stamp}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}

        {/* Hero number / headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: stamp ? 26 : 40,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: card?.kind === "summit" ? 150 : 132,
              fontWeight: 800,
              color: ACCENT,
              lineHeight: 1,
            }}
          >
            {bigText}
          </div>
          {bigSub ? (
            <div
              style={{
                display: "flex",
                fontSize: 38,
                color: FG_MUTED,
                marginTop: 18,
                maxWidth: 820,
              }}
            >
              {bigSub}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
        </div>

        {/* Stat row (campaign variants) */}
        {statRow.length > 0 ? (
          <div style={{ display: "flex", gap: 40, marginTop: 22, fontSize: 32 }}>
            {statRow.map((s, i) => (
              <div
                key={i}
                style={{ display: "flex", color: FG, fontWeight: 700 }}
              >
                {s}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}

        {/* CTA pinned to the floor */}
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            fontSize: 28,
            color: ACCENT,
            fontWeight: 700,
          }}
        >
          {cta}
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
