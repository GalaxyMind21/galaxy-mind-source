// /api/og/float · OG card for /float shareable URLs
//
// Produces a 1200×630 PNG via Next.js ImageResponse. Reads the
// requested date's FloatSnapshot from KV. Missing dates fail closed
// to a branded card with no invented numbers.
// Brass-and-orange branded card matching the page's vocabulary.
//
// Used by:
//   - <head> meta tags (default OG card on /float)
//   - SHARE button URLs (/float?d=YYYY-MM-DD renders that day's
//     historical OG card · same architecture as /api/og/stack)

import { ImageResponse } from "next/og";
import { kvList, kvIncrWithTtl, isKvConfigured } from "@/lib/kv";
import { getClientIp } from "@/lib/client-ip";
import { SANS, LAMP, benchFonts } from "@/lib/og-bench";
import { recomputeFromCohorts, type FloatSnapshot } from "@/lib/float-snapshot";

export const runtime = "nodejs";
// 24-hour edge cache · matches /api/og/stack. Historical dated
// cards are immutable (yesterday's snapshot doesn't change), and
// the live card only needs to update when the daily cron lands ·
// 24h is the right ceiling for both cases.
export const revalidate = 86_400;

const HISTORY_KEY = "float:history";



// Per-IP rate limit · same justification as /api/og/stack (audit
// 2026-05-21 · MEDIUM). Each render runs Satori + PNG encode which is
// expensive; the per-URL edge cache absorbs legitimate scrapes, but
// `?d=...` permutation spraying can force fresh renders. 30/min/IP
// is well above any legitimate use.
const OG_RATE_LIMIT_MAX = 30;
const OG_RATE_LIMIT_WINDOW_S = 60;

export async function GET(req: Request) {
  if (isKvConfigured()) {
    const ip = getClientIp(req);
    const count = await kvIncrWithTtl(
      `og:float:rl:${ip}`,
      OG_RATE_LIMIT_WINDOW_S,
    );
    if (count != null && count > OG_RATE_LIMIT_MAX) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "Retry-After": String(OG_RATE_LIMIT_WINDOW_S) },
      });
    }
  }

  const url = new URL(req.url);
  // Validate ?d= against YYYY-MM-DD shape · matches the date format
  // stored in FloatSnapshot. Malformed input falls through to today
  // rather than rendering an empty card · matches /api/og/stack
  // security posture (no arbitrary query text reaches the rendered
  // image).
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const rawDateParam = url.searchParams.get("d");
  const dateParam = rawDateParam && DATE_RE.test(rawDateParam) ? rawDateParam : null;

  let snapshot: FloatSnapshot | null = null;
  let dailyDelta: number | null = null;

  // Pull a year of history so we can find the requested date and
  // compute its delta vs the previous day. 365 entries is well
  // within KV-list latency budget for an OG card route (sub-100ms).
  // Re-derive inPlay using current methodology so historical OG
  // cards stay consistent with the live page (mirrors float-data.ts).
  const rawHistory = await kvList<FloatSnapshot>(HISTORY_KEY, 365);
  const history = rawHistory.map(recomputeFromCohorts);

  if (dateParam) {
    const idx = history.findIndex((h) => h.date === dateParam);
    snapshot = idx >= 0 ? history[idx] : null;
    if (idx >= 0 && history[idx + 1]) {
      dailyDelta = snapshot!.inPlay - history[idx + 1].inPlay;
    }
  } else {
    snapshot = history[0] ?? null;
    if (snapshot && history[1]) dailyDelta = snapshot.inPlay - history[1].inPlay;
  }

  // Fail closed · a missing date or empty history used to mint the
  // hardcoded baseline as a SNAPSHOT card, cached 24h. Same class as
  // the /api/og/stack integrity gate.
  if (!snapshot) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#12110F",
            backgroundImage: LAMP,
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            fontFamily: SANS,
            padding: 60,
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: "#F2EFE9",
              letterSpacing: 4.4,
            }}
          >
            THE BITCOIN FLOAT
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
            }}
          >
            <span
              style={{
                fontSize: 72,
                color: "#F7931A",
                fontWeight: 500,
                letterSpacing: -2,
              }}
            >
              GALAXY MIND
            </span>
            <span style={{ fontSize: 28, color: "#a07a4a", marginTop: 16 }}>
              float syncing
            </span>
          </div>
          <span style={{ fontSize: 18, color: "#948F84" }}>galaxymind.space/float</span>
        </div>
      ),
      { width: 1200, height: 630, fonts: benchFonts() },
    );
  }

  // SATORI / ImageResponse strict-mode notes (May 2026):
  //   · `fontFamily: "JetBrains Mono"` triggers a runtime dynamic-font
  //     fetch that can fail in production · `monospace` is the safe
  //     system fallback used by /api/og/stack
  //   · `position: "absolute"` requires a `position: "relative"` parent
  //     · without it Satori throws a 500
  //   · The `⌬` glyph (U+232C) isn't in standard fonts and triggers
  //     another dynamic-font fetch that can fail · using `B` instead
  //     stays compatible with monospace
  //
  // Layout reorganized to use pure flex (header bar at top, hero
  // centered, footer bar at bottom) instead of absolute positioning.
  // Mirrors the working /api/og/stack architecture.
  const pct = (snapshot.inPlay / snapshot.totalSupply) * 100;
  // Display as "14.84M" abbreviated (matches the /float page hero) ·
  // the raw 13,772,401 form bleeds off the OG canvas edges at
  // fontSize 180 and reads as visual noise rather than a striking
  // headline number.
  const inPlayMillions = (snapshot.inPlay / 1_000_000).toFixed(2);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#12110F",
          backgroundImage: LAMP,
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          fontFamily: SANS,
          padding: 60,
          justifyContent: "space-between",
        }}
      >
        {/* Top bar · brand + date */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: "#F2EFE9",
              letterSpacing: 4.4,
            }}
          >
            THE BITCOIN FLOAT
          </span>
          <span
            style={{
              fontSize: 16,
              color: "#a07a4a",
              letterSpacing: 3.2,
            }}
          >
            {snapshot.date}
          </span>
        </div>

        {/* Hero · big number + units + percentage */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 24,
            }}
          >
            <span
              style={{
                fontSize: 240,
                color: "#F7931A",
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: -7.2,
              }}
            >
              {inPlayMillions}M
            </span>
            <span style={{ fontSize: 56, color: "#888" }}>BTC</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "#bbb",
              marginTop: 24,
              letterSpacing: 2,
            }}
          >
            in play · {pct.toFixed(1)}% of 21M cap
          </div>
          {dailyDelta !== null && dailyDelta !== 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 26,
                color: dailyDelta < 0 ? "#FB923C" : "#4ADE80",
                marginTop: 28,
                fontWeight: 600,
              }}
            >
              {/* The DOWN state is a ROTATED up-triangle, not U+25BC.
                  The face first used here covered ▲ but not ▼, and a glyph
                  the font lacks sends Satori to the network: probed 2026-09-10,
                  `Failed to load dynamic font for ▼ . Status: 400`, and
                  the card rendered tofu. Same failure class as the ★ / ₿
                  ban the other cards document. This keeps the site's own
                  ▲/▼ vocabulary with no glyph and no fetch. */}
              <span
                style={{
                  display: "flex",
                  // Spread, never `transform: undefined`. Satori VALIDATES the
                  // value instead of ignoring it the way the DOM would, so the
                  // undefined branch 500s the whole card — and that was the
                  // branch today's data takes.
                  ...(dailyDelta < 0
                    ? { transform: "rotate(180deg)" }
                    : {}),
                }}
              >
                ▲
              </span>
              <span style={{ display: "flex" }}>
                {Math.abs(dailyDelta).toLocaleString("en-US", {
                  maximumFractionDigits: 0,
                })}{" "}
                BTC {dailyDelta < 0 ? "drained" : "added"} yesterday
              </span>
            </div>
          )}
        </div>

        {/* Bottom bar · URL + brand */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span
            style={{
              fontSize: 18,
              color: "#a07a4a",
              letterSpacing: 3.6,
            }}
          >
            galaxymind.space/float
          </span>
          <span
            style={{
              fontSize: 18,
              color: "#F7931A",
              letterSpacing: 3.6,
            }}
          >
            GALAXY MIND
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: benchFonts(),
      // Edge cache matched to this route's own `revalidate = 86_400`
      // (fixed 2026-07-25). next/og seeds max-age=0, so the declared
      // 24h intent never reached the CDN and every scrape re-rendered.
      headers: {
        "Cache-Control":
          "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
