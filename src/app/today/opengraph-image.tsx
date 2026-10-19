// Daily-briefing OG card · the share artifact for /today. Fresh
// numbers every day mean a fresh billboard every day: the operator's
// daily post always previews with current readings instead of a
// stale generic card. Calls the market/float libs directly (no
// internal HTTP round-trip) · same pattern as /fit/opengraph-image.

import { ImageResponse } from "next/og";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { getFloatData } from "@/lib/float-data";
import { VENDORS } from "@/lib/vendors";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "Today in Bitcoin · the Galaxy Mind daily briefing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 1800;

const ACCENT = "#F7931A";
const BG = "#12110F";
const BG_ELEV = "#1C1A16";
const BORDER = "rgba(247, 238, 224, 0.085)";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const FG_DIM = "#948F84";

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        background: BG_ELEV,
        border: `1px solid ${BORDER}`,
        borderTop: "1px solid #55503F",
        borderRadius: 16,
        padding: "26px 28px",
        marginRight: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 17,
          letterSpacing: "0.2em",
          color: FG_DIM,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 52,
          fontWeight: 500,
          color: ACCENT,
          marginTop: 14,
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 19,
          color: FG_MUTED,
          marginTop: 10,
        }}
      >
        {sub}
      </div>
    </div>
  );
}

export default async function Image() {
  const [snapshot, float] = await Promise.all([
    getMarketSnapshot(),
    getFloatData({ days: 2, synthetic: false }),
  ]);
  const verdict = computeStackVerdict(snapshot);
  const degraded = isMarketSnapshotDegraded(snapshot);
  const cheapest = [...snapshot.treasuries]
    .filter((r) => r.mNAV != null)
    .sort((a, b) => (a.mNAV ?? Infinity) - (b.mNAV ?? Infinity))[0];

  const dateLabel = new Date().toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const gaugeValue = degraded ? "··" : `${verdict.score}/100`;
  const gaugeSub = degraded ? "updating" : TIER_LABEL[verdict.tier];
  const floatValue = float.isFallback
    ? "··"
    : `${(float.current.inPlay / 1_000_000).toFixed(2)}M`;
  const floatSub = float.isFallback ? "syncing" : "BTC still purchasable";
  const treasValue = cheapest?.mNAV == null ? "··" : `${cheapest.mNAV.toFixed(2)}×`;
  const treasSub =
    cheapest?.mNAV == null
      ? "updating"
      : `${cheapest.ticker} · cheapest treasury`;

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
        }}
      >
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
            Daily Briefing
          </div>
        </div>
        <div
          style={{
            display: "flex",
            height: 3,
            marginTop: 18,
            background: `linear-gradient(90deg, ${ACCENT}, rgba(247,147,26,0.1) 60%, rgba(0,0,0,0))`,
          }}
        />

        <div
          style={{
            display: "flex",
            fontSize: 58,
            fontWeight: 500,
            marginTop: 36,
          }}
        >
          Today in bitcoin.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: FG_MUTED,
            marginTop: 10,
          }}
        >
          {dateLabel} · UTC
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 40,
            flexGrow: 1,
          }}
        >
          <Tile label="Buying Gauge" value={gaugeValue} sub={gaugeSub} />
          <Tile label="Still in play" value={floatValue} sub={floatSub} />
          <Tile label="Cheapest mNAV" value={treasValue} sub={treasSub} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              flexBasis: 0,
              background: BG_ELEV,
              border: `1px solid ${BORDER}`,
              borderTop: "1px solid #55503F",
              borderRadius: 16,
              padding: "26px 28px",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 17,
                letterSpacing: "0.2em",
                color: FG_DIM,
                textTransform: "uppercase",
              }}
            >
              Circular economy
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 52,
                fontWeight: 500,
                color: ACCENT,
                marginTop: 14,
              }}
            >
              {VENDORS.length}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 19,
                color: FG_MUTED,
                marginTop: 10,
              }}
            >
              verified merchants
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: FG_DIM,
            letterSpacing: "0.08em",
            marginTop: 36,
          }}
        >
          <div style={{ display: "flex" }}>
            galaxymind.space/today · updated all day
          </div>
          <div style={{ display: "flex" }}>Not financial advice</div>
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
