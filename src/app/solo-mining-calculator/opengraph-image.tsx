import { ImageResponse } from "next/og";
import { getHashrateDesk } from "@/lib/hashrate";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

// Own card — the calculator's question, not the desk's pitch. Shares the
// live-prize-with-honest-fallback discipline of /hashrate's sibling.
export const alt =
  "Solo mining odds calculator · could you find a bitcoin block?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const ACCENT = "#F7931A";
const BG = "#12110F";
const BG_ELEV = "#1C1A16";
const BORDER = "rgba(247, 238, 224, 0.085)";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

export default async function Image() {
  const desk = await getHashrateDesk();
  const prize =
    desk.blockRewardBtc != null && desk.btcUsd != null
      ? Math.round(desk.blockRewardBtc * desk.btcUsd)
      : null;

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
            SOLO MINING ODDS CALCULATOR
          </span>
          <span style={{ fontSize: 18, color: FG_MUTED, letterSpacing: 3.6 }}>
            · GALAXY MIND
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "center",
            gap: 28,
          }}
        >
          <span style={{ fontSize: 34, color: FG_MUTED, letterSpacing: 6.8 }}>
            COULD YOU FIND A BLOCK?
          </span>
          <span style={{ fontSize: 96, color: ACCENT, fontWeight: 500 }}>
            {prize != null
              ? `IT PAYS $${prize.toLocaleString("en-US")}`
              : "THE WHOLE REWARD"}
          </span>
          <span style={{ fontSize: 28, color: FG }}>
            Exact odds from live network hashrate · any machine, any window
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: BG_ELEV,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: "20px 32px",
          }}
        >
          <span style={{ fontSize: 22, color: FG_MUTED }}>
            The exact math · no signup, no spreadsheet
          </span>
          <span style={{ fontSize: 22, color: ACCENT }}>
            galaxymind.space/solo-mining-calculator
          </span>
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
