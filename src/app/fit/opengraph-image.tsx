// Dynamic OG image for the allocation engine. Embeds live BTC price,
// MSTR mNAV, and Fear & Greed by calling the market lib directly — no
// internal HTTP round-trip means no VERCEL_URL/canonical-domain issues
// and no doubled rate-limit pressure on upstreams.
import { ImageResponse } from "next/og";
import { getMarketSnapshot } from "@/lib/market";
import { OgGalaxyPin } from "@/lib/og-galaxy-pin";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const runtime = "nodejs";
export const alt = "Find Your Bitcoin Fit · Galaxy Mind Allocation Engine";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// 5-minute revalidation to keep signals fresh without hammering upstreams.
export const revalidate = 300;

const ACCENT = "#F7931A";
const BG = "#12110F";
const BORDER = "rgba(247, 238, 224, 0.085)";
const TEXT_PRIMARY = "#F2EFE9";
const TEXT_SECONDARY = "#A5A096";
const TEXT_TERTIARY = "#948F84";
const SUCCESS = "#4ADE80";
const WARNING = "#FB923C";

export default async function Image() {
  const snapshot = await getMarketSnapshot();
  const mstr = snapshot.treasuries.find((t) => t.ticker === "MSTR");
  const m = {
    btcPrice: snapshot.btcPrice,
    mNAV: mstr?.mNAV ?? null,
    fearGreed: snapshot.fearGreed,
    fearGreedLabel: snapshot.fearGreedLabel,
  };

  const fmtPrice = (p: number | null) =>
    p == null
      ? "·"
      : `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const fmtMNAV = (m: number | null) => (m == null ? "·" : `${m.toFixed(2)}×`);
  const fmtFG = (n: number | null, l: string | null) =>
    n == null ? "·" : l ? `${n} ${l}` : String(n);

  // Tone-color logic mirrors the on-page badge logic
  const mNAVTone =
    m.mNAV == null ? TEXT_PRIMARY
    : m.mNAV >= 1.6 ? "#EF4444"
    : m.mNAV >= 0.85 && m.mNAV < 1.05 ? SUCCESS
    : TEXT_PRIMARY;
  const fgTone =
    m.fearGreed == null ? TEXT_PRIMARY
    : m.fearGreed >= 80 ? "#EF4444"
    : m.fearGreed <= 20 ? SUCCESS
    : m.fearGreed >= 65 ? WARNING
    : TEXT_PRIMARY;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          backgroundImage: LAMP,
          display: "flex",
          flexDirection: "column",
          padding: 64,
          color: TEXT_PRIMARY,
          fontFamily: SANS,
        }}
      >
        {/* Brand · see /opengraph-image.tsx for why no ₿ glyph here. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <OgGalaxyPin size={40} />
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 20,
              letterSpacing: 4,
              color: TEXT_PRIMARY,
            }}
          >
            GALAXY MIND
          </span>
        </div>

        {/* Live signals row */}
        <div
          style={{
            display: "flex",
            gap: 36,
            marginTop: 56,
            paddingBottom: 28,
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <Stat label="BTC" value={fmtPrice(m.btcPrice)} />
          <Stat label="MSTR mNAV" value={fmtMNAV(m.mNAV)} valueColor={mNAVTone} />
          <Stat label="F&G" value={fmtFG(m.fearGreed, m.fearGreedLabel)} valueColor={fgTone} />
        </div>

        {/* Hero */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            marginTop: 56,
          }}
        >
          {/* Satori strips trailing whitespace from text nodes in flex
              containers; using NBSP ( ) preserves visible spacing
              between the multi-color words. */}
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 96,
                fontWeight: 500,
                color: TEXT_PRIMARY,
                lineHeight: 1,
                letterSpacing: -2.9,
              }}
            >
              {"Find your "}
            </span>
            <span
              style={{
                fontSize: 96,
                fontWeight: 500,
                color: ACCENT,
                lineHeight: 1,
                letterSpacing: -2.9,
              }}
            >
              bitcoin fit
            </span>
            <span
              style={{
                fontSize: 96,
                fontWeight: 500,
                color: TEXT_PRIMARY,
                lineHeight: 1,
                letterSpacing: -2.9,
              }}
            >
              .
            </span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              color: TEXT_SECONDARY,
              maxWidth: 980,
              lineHeight: 1.3,
            }}
          >
            {"Live decision engine for Bitcoin and Bitcoin-adjacent securities. Recommendations factor in mNAV, Fear & Greed, and 30-day BTC volatility."}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            borderTop: `1px solid ${BORDER}`,
            paddingTop: 24,
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 22,
              color: TEXT_PRIMARY,
              letterSpacing: 1,
            }}
          >
            galaxymind.space/fit
          </span>
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 14,
              color: TEXT_TERTIARY,
              letterSpacing: 2.8,
              textTransform: "uppercase",
            }}
          >
            Not financial advice
          </span>
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}

function Stat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 14,
          color: TEXT_TERTIARY,
          letterSpacing: 2.8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 38,
          fontWeight: 700,
          color: valueColor ?? TEXT_PRIMARY,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}
