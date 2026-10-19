// Per-run share card image · rendered on demand from the run encoded in
// the path segment (see lib/run-card). This is the image X/social fetch
// when someone shares their run. Every value is already clamped by
// decodeRunCard; a malformed segment falls back to a generic card.

import { ImageResponse } from "next/og";
import { decodeRunCard } from "@/lib/run-card";
import { SANS, benchFonts, LAMP } from "@/lib/og-bench";

export const alt = "A Bitcoin Gauntlet · Node Runner result · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// A given data segment renders deterministically · let the CDN absorb
// unfurler RE-SCRAPES of the same URL instead of paying the Satori
// render each time (audit 2026-07-11 · the /api/og/stack lesson).
//
// 2026-08 audit correction · the previous version of this comment also
// claimed the cache absorbs "garbage-segment floods". It does not:
// revalidate keys on the URL, so a flood of DISTINCT segments is 100%
// cache misses by construction, and each miss pays a full render (a
// null decode falls back to defaults and still renders every element —
// it is not a cheap path). Two things keep that from being a real DoS,
// and neither is this cache: decodeRunCard clamps every field, so the
// cost per render is CONSTANT and no worse than a legitimate share
// card; and the nonce CSP already makes every HTML page per-request
// dynamic, so an attacker gains no amplification they didn't already
// have against `/`. Left as-is deliberately. If that calculus changes,
// the lever is a matcher-scoped check in src/proxy.ts (which already
// runs on this path) or a notFound() when decodeRunCard returns null —
// NOT per-IP limiting, which the opengraph-image convention can't do.
export const revalidate = 86400;

const ACCENT = "#F7931A";
const BG = "#12110F";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const GREEN = "#31C48D";
const RED = "#ff3a4f";

// Same suggestive tape silhouette as the static /runner card.
const BARS = [
  92, 118, 148, 132, 104, 78, 56, 44, 38, 52, 64, 72, 86, 108, 128, 142, 126,
  138, 152, 144, 156,
];

export default async function Image({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeRunCard(data);

  const present = run?.present ?? false;
  const days = run?.days ?? 0;
  const sats = run?.sats ?? 0;
  const combo = run?.combo ?? 0;
  const era = run?.era ?? null;
  const handle = run?.handle ?? null;
  const headline = present ? "REACHED THE PRESENT" : "REKT";
  const headlineColor = present ? GREEN : ACCENT;

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
        {/* Tape silhouette anchored to the bottom */}
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
            opacity: 0.18,
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

        {/* Eyebrow + handle */}
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
          <div style={{ display: "flex" }}>Galaxy Mind · Node Runner</div>
          {handle && (
            <div style={{ display: "flex", letterSpacing: 2, color: ACCENT }}>
              {handle}
            </div>
          )}
        </div>

        {/* Verdict stamp */}
        <div
          style={{
            display: "flex",
            marginTop: 30,
            padding: "10px 26px",
            border: `4px solid ${headlineColor}`,
            borderRadius: 12,
            color: headlineColor,
            fontSize: 60,
            fontWeight: 800,
            letterSpacing: 4,
            alignSelf: "flex-start",
            transform: "rotate(-2deg)",
          }}
        >
          {headline}
        </div>

        {/* Big number · days survived */}
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 34 }}>
          <div style={{ display: "flex", fontSize: 150, fontWeight: 500 }}>
            {days.toLocaleString("en-US")}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 44,
              color: FG_MUTED,
              marginLeft: 20,
            }}
          >
            days of actual bitcoin history survived
          </div>
        </div>

        {/* Stat row */}
        <div style={{ display: "flex", gap: 40, marginTop: 18, fontSize: 34 }}>
          <div style={{ display: "flex", color: ACCENT, fontWeight: 700 }}>
            {sats.toLocaleString("en-US")} sats
          </div>
          {combo >= 3 && (
            <div style={{ display: "flex", color: GREEN, fontWeight: 700 }}>
              ×{combo} peak combo
            </div>
          )}
          {!present && era && (
            <div style={{ display: "flex", color: RED, fontWeight: 700 }}>
              killed by {era}
            </div>
          )}
        </div>

        {/* CTA */}
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            fontSize: 28,
            color: ACCENT,
            fontWeight: 700,
          }}
        >
          {present
            ? "Caught the present, then the moon 🌙 · galaxymind.space/runner"
            : "Can you outrun the tape? · galaxymind.space/runner"}
        </div>
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
