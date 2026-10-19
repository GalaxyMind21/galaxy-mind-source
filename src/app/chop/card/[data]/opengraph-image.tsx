// Per-run share card image · rendered on demand from the run encoded in
// the path segment (see lib/chop-card). This is the image X/social fetch
// when someone shares their run. Every value is already clamped by
// decodeChopCard; a malformed segment falls back to a generic card.

import { ImageResponse } from "next/og";
import { decodeChopCard } from "@/lib/chop-card";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "A CHOP result · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// A given data segment renders deterministically · let the CDN absorb
// unfurler re-scrapes of the same URL instead of paying the Satori
// render each time (same posture as the runner/kart cards).
export const revalidate = 86400;

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const GREEN = "#31C48D";
const RED = "#ff3a4f";

const CUBES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export default async function Image({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeChopCard(data);

  const orphaned = run?.orphaned ?? false;
  const stamp = orphaned ? "BLOCK ORPHANED" : run ? "BLOCK CLEARED" : "CHOP";
  const stampColor = orphaned ? RED : ACCENT;
  const sats = run?.sats ?? 0;
  const grade = run?.grade || null;
  const combo = run?.combo ?? 0;
  const height = run?.height ?? null;

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
        {/* Cube strip anchored to the bottom */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            gap: 18,
            padding: "0 48px 28px",
            opacity: 0.22,
          }}
        >
          {CUBES.map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 52,
                height: 52,
                background: i === CUBES.length - 1 ? ACCENT : "rgba(247,147,26,0.7)",
                borderRadius: 8,
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
          <div style={{ display: "flex" }}>Galaxy Mind · CHOP</div>
          {height != null && (
            <div style={{ display: "flex", letterSpacing: 2, color: ACCENT }}>
              BLOCK {height.toLocaleString("en-US")}
            </div>
          )}
        </div>

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
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 34 }}>
              <div style={{ display: "flex", fontSize: 150, fontWeight: 500 }}>
                {sats.toLocaleString("en-US")}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 44,
                  color: FG_MUTED,
                  marginLeft: 20,
                }}
              >
                sats
              </div>
            </div>
            <div style={{ display: "flex", gap: 40, marginTop: 18, fontSize: 34 }}>
              {grade && (
                <div style={{ display: "flex", color: ACCENT, fontWeight: 700 }}>
                  {grade}
                </div>
              )}
              {combo >= 1 && (
                <div style={{ display: "flex", color: GREEN, fontWeight: 700 }}>
                  ×{combo} combo
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 120,
                fontWeight: 500,
                marginTop: 40,
              }}
            >
              CHOP
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 40,
                color: FG_MUTED,
                marginTop: 10,
              }}
            >
              Slice the live bitcoin block
            </div>
          </div>
        )}

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
          Slice the live block · galaxymind.space/chop
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
