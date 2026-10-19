import { ImageResponse } from "next/og";
import { getHashrateDesk } from "@/lib/hashrate";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

// The page shipped with OG_TREASURY — the mNAV scoreboard card — so every
// social unfurl of a hashrate-rental link argued with its own headline,
// which lib/og.ts itself calls "worse than none". This card carries the
// actual pitch, with the live prize when the feeds answer and an honest
// non-numeric line when they don't.
export const alt =
  "Rent Bitcoin hashrate from Galaxy Mind · live block odds";
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
            RENT BITCOIN HASHRATE
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
          <span style={{ fontSize: 30, color: FG_MUTED, letterSpacing: 6 }}>
            WHOEVER FINDS THE NEXT BLOCK TAKES
          </span>
          <span style={{ fontSize: 120, color: ACCENT, fontWeight: 500 }}>
            {prize != null ? `$${prize.toLocaleString("en-US")}` : "THE BLOCK REWARD"}
          </span>
          <span style={{ fontSize: 28, color: FG }}>
            SHA-256 hash power · you pick the pool · blocks pay your wallet
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
            Rent from 3 hours to 7 days · we never hold your coins
          </span>
          <span style={{ fontSize: 22, color: ACCENT }}>
            galaxymind.space/hashrate
          </span>
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
