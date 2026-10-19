// Dynamic OG image for /stack. Same direct-import pattern as /fit's OG —
// calls getMarketSnapshot() in-process so we don't pay an internal HTTP
// round-trip and don't compound rate-limit pressure on upstreams.
import { ImageResponse } from "next/og";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict } from "@/lib/stack";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt =
  "The Bitcoin Buying Gauge: when's the best time to buy? · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// 5-minute revalidation matches /fit's cadence.
export const revalidate = 300;

// CSS-var values are duplicated here on purpose — the OG runtime
// (Satori) doesn't have access to globals.css, so we hard-code the
// design-system constants we need.
const ACCENT = "#F7931A";
const BG = "#12110F";
const BG_ELEV = "#1C1A16";
const BORDER = "rgba(247, 238, 224, 0.085)";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

export default async function Image() {
  const snapshot = await getMarketSnapshot();
  const v = computeStackVerdict(snapshot);

  // Static needle pose for the gauge; matches the on-page mapping
  // (score 0 → -90deg, score 100 → +90deg).
  const deg = (v.score / 100) * 180 - 90;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          backgroundImage: LAMP,
          color: FG,
          display: "flex",
          flexDirection: "column",
          fontFamily: SANS,
          padding: 60,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontSize: 26, color: "#F2EFE9", letterSpacing: 5.2 }}>
            BITCOIN BUYING GAUGE
          </span>
          <span style={{ fontSize: 16, color: FG_MUTED, letterSpacing: 3.2 }}>
            · GALAXY MIND
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 80,
          }}
        >
          <svg width="380" height="220" viewBox="0 0 400 220">
            <path
              d="M 30 200 A 170 170 0 0 1 370 200"
              stroke={BORDER}
              strokeWidth="3"
              fill="none"
            />
            <path
              d="M 200 30 A 170 170 0 0 1 370 200"
              stroke={v.score >= 65 ? ACCENT : BORDER}
              strokeWidth={v.score >= 65 ? "5" : "3"}
              fill="none"
              opacity={v.score >= 65 ? 0.95 : 0.4}
            />
            <line
              x1="200"
              y1="200"
              x2={200 + Math.cos(((deg - 90) * Math.PI) / 180) * 150}
              y2={200 + Math.sin(((deg - 90) * Math.PI) / 180) * 150}
              stroke={ACCENT}
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx="200" cy="200" r="9" fill={ACCENT} />
          </svg>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 200,
                color: ACCENT,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >{String(v.score)}</div>
            <div style={{ display: "flex", fontSize: 36, letterSpacing: 7.2, marginTop: 8 }}>{v.tier}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          {v.signals.slice(0, 3).map((s) => (
            <div
              key={s.name}
              style={{
                background: BG_ELEV,
                border: `1px solid ${BORDER}`,
                padding: "12px 20px",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                minWidth: 200,
              }}
            >
              <div style={{ display: "flex", fontSize: 14, color: FG_MUTED, letterSpacing: 2.8 }}>{s.name.toUpperCase()}</div>
              <div
                style={{
                  display: "flex",
                  fontSize: 32,
                  color: ACCENT,
                  fontVariantNumeric: "tabular-nums",
                }}
              >{String(s.normalized)}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 16,
            fontSize: 18,
            color: FG_MUTED,
          }}
        >
          galaxymind.space/stack
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
