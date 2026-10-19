// Per-portfolio OG image for shared /fit links.
//
// ShareScenarioRow puts /fit?h=10&t=4&a=roth in every copied link and
// tweet. generateMetadata in /fit/page.tsx routes scrapers here when
// those params are valid, so the shared card shows the SENDER'S sleeve
// mix instead of the generic live-signals card.
//
// Security model mirrors /api/og/stack: only three params are honored,
// each strictly validated (h 1-30 int, t 1-6 int, a ∈ {taxable,
// traditional, roth}). Anything invalid renders the generic branded
// card. No free text ever flows from the query into the image · the
// sleeves are recomputed by recommend() server-side, so a crafted URL
// can only render a portfolio the engine would genuinely produce.

import { ImageResponse } from "next/og";
import { getMarketSnapshot } from "@/lib/market";
import {
  recommend,
  TOLERANCE_LABELS,
  type AccountType,
  type SleeveRole,
  type Tolerance,
} from "@/lib/recommend";
import { rateLimit } from "@/lib/rate-limit";
import { SANS, LAMP, benchFonts } from "@/lib/og-bench";

export const runtime = "nodejs";
// 1 hour at the edge. The engine folds in live signals (mNAV tilt,
// Fear & Greed), so the same URL can drift a few points over a day ·
// that is honest behavior for a "live recommendation" card, and an
// hour of caching keeps scraper storms off the upstream APIs.
export const revalidate = 3600;

const ACCENT = "#F7931A";
const BG = "#12110F";
const BG_ELEV = "#1C1A16";
const BORDER = "rgba(247, 238, 224, 0.085)";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";
const FG_DIM = "#948F84";

// Sleeve palette · mirrors SLEEVE_COLORS in src/app/fit/FitClient.tsx
// (that file is "use client", so its values can't be imported into a
// route handler · keep the two in sync when adding a role).
const ROLE_COLORS: Record<SleeveRole, string> = {
  core_btc: "#F7931A",
  leveraged_eq: "#FCD34D",
  treasury_diversifier: "#FB7185",
  treasury_diversifier_2: "#E11D48",
  income_low_vol: "#22C55E",
  income_fixed: "#10B981",
  income_high_yield: "#0EA5E9",
  income_hybrid: "#A78BFA",
  preferred_diversifier: "#14B8A6",
  deriv_income: "#F472B6",
  speculative: "#DC2626",
  ludicrous_lev: "#7C3AED",
};

const ACCOUNT_LABELS: Record<AccountType, string> = {
  taxable: "Taxable",
  traditional: "Traditional IRA",
  roth: "Roth IRA",
};

function parseParams(url: URL): {
  h: number;
  t: Tolerance;
  a: AccountType;
} | null {
  const h = parseInt(url.searchParams.get("h") ?? "", 10);
  const t = parseInt(url.searchParams.get("t") ?? "", 10);
  const a = url.searchParams.get("a") ?? "";
  if (!Number.isFinite(h) || h < 1 || h > 30) return null;
  if (!Number.isFinite(t) || t < 1 || t > 6) return null;
  if (a !== "taxable" && a !== "traditional" && a !== "roth") return null;
  return { h, t: t as Tolerance, a };
}

export async function GET(req: Request) {
  // Per-IP soft cap · mirrors /api/og/stack (audit 2026-07-09). Each
  // miss can fan out getMarketSnapshot + recommend + Satori.
  const rl = await rateLimit(req, {
    name: "og-fit",
    limit: 30,
    windowSec: 60,
  });
  if (!rl.ok) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...rl.headers, "Retry-After": rl.headers["Retry-After"] ?? "60" },
    });
  }

  const parsed = parseParams(new URL(req.url));

  // Invalid params → generic branded card (never an error image · a
  // mangled share link should still look intentional in a timeline).
  if (!parsed) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: BG,
            backgroundImage: LAMP,
            color: FG,
            fontSize: 56,
            fontWeight: 500,
          }}
        >
          <div style={{ display: "flex", color: ACCENT }}>
            Find your bitcoin fit.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              color: FG_MUTED,
              marginTop: 18,
            }}
          >
            galaxymind.space/fit · the Bitcoin allocation engine
          </div>
        </div>
      ),
      // Static branded card for a mangled link · nothing live in it, so
      // it can be cached hard. (next/og otherwise sends max-age=0 and
      // every scrape re-renders · fixed 2026-07-25.)
      {
        width: 1200,
        height: 630,
        fonts: benchFonts(),
        headers: {
          "Cache-Control":
            "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable",
        },
      },
    );
  }

  const { h, t, a } = parsed;
  const snapshot = await getMarketSnapshot();
  const mNAVByTicker: Record<string, number | null> = {};
  for (const tr of snapshot.treasuries) mNAVByTicker[tr.ticker] = tr.mNAV;

  const rec = recommend({
    horizonYears: h,
    volatilityTolerance: t,
    accountType: a,
    mNAVByTicker,
    fearGreed: snapshot.fearGreed,
    btcVol30d: snapshot.btcVol30d,
  });

  const sleeves = [...rec.allocation].sort((x, y) => y.weight - x.weight);
  const top = sleeves.slice(0, 5);
  const moreCount = sleeves.length - top.length;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: FG,
          padding: "48px 56px",
          fontFamily: SANS,
        }}
      >
        {/* Masthead · wordmark left, channel label right, accent rule */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Plain-text wordmark · Satori's bundled font subset has no
              U+20BF (the documented "★ / ₿" failure in og/stack), so the
              bitcoin sign renders as tofu here. Orange G carries the
              brand accent instead. */}
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
            }}
          >
            MY BITCOIN FIT
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

        {/* Profile line */}
        <div
          style={{
            display: "flex",
            marginTop: 34,
            fontSize: 30,
            color: FG_MUTED,
          }}
        >
          <span style={{ color: ACCENT, fontWeight: 700 }}>
            {TOLERANCE_LABELS[t]}
          </span>
          <span style={{ margin: "0 14px" }}>·</span>
          <span>{h}y horizon</span>
          <span style={{ margin: "0 14px" }}>·</span>
          <span>{ACCOUNT_LABELS[a]}</span>
        </div>

        {/* Allocation bar */}
        <div
          style={{
            display: "flex",
            height: 34,
            borderRadius: 17,
            overflow: "hidden",
            marginTop: 28,
            border: `1px solid ${BORDER}`,
            background: BG_ELEV,
          }}
        >
          {sleeves.map((s) => (
            <div
              key={s.asset.ticker}
              style={{
                display: "flex",
                width: `${s.weight * 100}%`,
                background: ROLE_COLORS[s.role],
              }}
            />
          ))}
        </div>

        {/* Sleeve rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 30,
            flexGrow: 1,
          }}
        >
          {top.map((s) => (
            <div
              key={s.asset.ticker}
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 16,
                fontSize: 32,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: ROLE_COLORS[s.role],
                  marginRight: 18,
                }}
              />
              <div
                style={{
                  display: "flex",
                  width: 110,
                  justifyContent: "flex-end",
                  fontWeight: 700,
                  color: ACCENT,
                }}
              >
                {Math.round(s.weight * 100)}%
              </div>
              <div
                style={{
                  display: "flex",
                  marginLeft: 24,
                  fontWeight: 600,
                }}
              >
                {s.asset.ticker}
              </div>
              <div
                style={{
                  display: "flex",
                  marginLeft: 18,
                  fontSize: 24,
                  color: FG_DIM,
                }}
              >
                {s.asset.name}
              </div>
            </div>
          ))}
          {moreCount > 0 ? (
            <div
              style={{
                display: "flex",
                fontSize: 24,
                color: FG_DIM,
                marginLeft: 34,
              }}
            >
              + {moreCount} more sleeve{moreCount === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: FG_DIM,
            letterSpacing: "0.08em",
          }}
        >
          <div style={{ display: "flex" }}>
            galaxymind.space/fit · live allocation engine
          </div>
          <div style={{ display: "flex" }}>
            A starting point, not financial advice
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: benchFonts(),
      // Edge cache matched to this route's own `revalidate = 3600`
      // (fixed 2026-07-25). next/og seeds max-age=0, so every scrape was
      // re-running getMarketSnapshot + recommend() + Satori — the note at
      // the top of this file about a cache miss fanning out that work was
      // describing EVERY request. 1h keeps the allocation numbers fresh
      // while collapsing repeat scrapes of a shared link.
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
