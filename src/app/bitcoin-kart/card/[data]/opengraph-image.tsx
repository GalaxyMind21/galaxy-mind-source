// Per-run share card image · rendered on demand from the race encoded in
// the path segment (see lib/kart-card). This is the image X/social fetch
// when someone shares their run. Every value is already validated by
// decodeKartCard (numbers clamped, track/driver/class strings allow-listed
// and mapped to OUR display names); a malformed segment falls back to a
// generic card.

import { ImageResponse } from "next/og";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";
import {
  decodeKartCard,
  formatKartCardTime,
  KART_TRACK_NAMES,
  KART_DRIVER_NAMES,
  KART_CLASS_LABELS,
} from "@/lib/kart-card";

export const alt = "A Bitcoin Kart race result · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// A given data segment renders deterministically · let the CDN absorb
// unfurler re-scrapes and garbage-segment floods instead of paying the
// Satori render each time (same posture as the runner/gauntlet cards ·
// per-IP limiting is impossible in the opengraph-image convention, the
// 24h per-URL cache is the available layer).
export const revalidate = 86400;

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const GREEN = "#31C48D";

// Checkered finish-line strip along the bottom · the kart analog of the
// runner card's tape silhouette.
const CHECKER_COLS = 24;

export default async function Image({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeKartCard(data);

  const trackName = run ? KART_TRACK_NAMES[run.trackId] : null;
  const driverName = run ? KART_DRIVER_NAMES[run.driverId] : null;
  const day = run?.day ?? null;
  const rank = run?.rank ?? null;
  const klass = run?.klass ?? null;
  const mirror = run?.mirror ?? false;

  const stamp =
    day != null ? `DAILY CIRCUIT #${day}` : rank === 1 ? "P1" : "RACE RESULT";
  const stampColor = rank === 1 ? GREEN : ACCENT;

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
        {/* Finish-line checkers anchored to the bottom */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            opacity: 0.22,
          }}
        >
          {[0, 1].map((row) => (
            <div key={row} style={{ display: "flex" }}>
              {Array.from({ length: CHECKER_COLS }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    width: 50,
                    height: 26,
                    background:
                      (i + row) % 2 === 0 ? ACCENT : "rgba(247,147,26,0.15)",
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Eyebrow + wordmark */}
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
          <div style={{ display: "flex" }}>Galaxy Mind · BITCOIN KART</div>
          {klass && (
            <div style={{ display: "flex", letterSpacing: 4 }}>
              {KART_CLASS_LABELS[klass]}
              {mirror ? " · MIRROR" : ""}
            </div>
          )}
        </div>

        {/* Verdict stamp */}
        <div
          style={{
            display: "flex",
            marginTop: 30,
            padding: "10px 26px",
            border: `4px solid ${stampColor}`,
            borderRadius: 12,
            color: stampColor,
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: 4,
            alignSelf: "flex-start",
            transform: "rotate(-2deg)",
          }}
        >
          {stamp}
        </div>

        {run ? (
          // Satori note: a fragment here would flow these rows as a ROW ·
          // wrap in an explicit column so time + stats stack.
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Big number · finish time */}
            <div
              style={{ display: "flex", alignItems: "baseline", marginTop: 34 }}
            >
              <div style={{ display: "flex", fontSize: 150, fontWeight: 500 }}>
                {formatKartCardTime(run.timeMs)}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 44,
                  color: FG_MUTED,
                  marginLeft: 24,
                }}
              >
                on {trackName}
              </div>
            </div>

            {/* Stat row */}
            <div
              style={{ display: "flex", gap: 40, marginTop: 18, fontSize: 34 }}
            >
              <div style={{ display: "flex", color: ACCENT, fontWeight: 700 }}>
                {driverName}
              </div>
              {rank != null && rank > 1 && (
                <div
                  style={{ display: "flex", color: FG_MUTED, fontWeight: 700 }}
                >
                  P{rank} on the grid
                </div>
              )}
              {rank === 1 && (
                <div
                  style={{ display: "flex", color: GREEN, fontWeight: 700 }}
                >
                  there is no second best
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Generic fallback · malformed segment */
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 120, fontWeight: 500, marginTop: 40 }}>
              BITCOIN KART
            </div>
            <div style={{ display: "flex", fontSize: 40, color: FG_MUTED, marginTop: 10 }}>
              One chair. Ten racers. No second best.
            </div>
          </div>
        )}

        {/* CTA / watermark */}
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            marginBottom: 44,
            fontSize: 28,
            color: ACCENT,
            fontWeight: 700,
          }}
        >
          {day != null
            ? "Same track for everyone today · galaxymind.space/bitcoin-kart"
            : "Beat that time · galaxymind.space/bitcoin-kart"}
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
