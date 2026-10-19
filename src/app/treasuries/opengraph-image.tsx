// Treasury mNAV scoreboard card. `OG_TREASURY` in lib/og.ts points the
// whole finance family here, so this is the second-most-unfurled card on
// the site after the root one.
//
// IT USED TO GO BLANK. The card is entirely data-driven off
// `snapshot.treasuries.filter(r => r.mNAV != null)`, and when the
// treasury feed is degraded that filter returns nothing: no cheapest
// block, no ranking rows, and the render collapsed to a wordmark, a
// stranded `LIVE RANKING (CHEAPEST FIRST)` label and a URL. Verified on
// production 2026-09-10 — all four tickers were null with
// `degraded: true`, and the live card was a near-empty rectangle.
//
// That is the worst failure mode a social card has: it is the artwork
// for every finance page we share, and an empty card reads as a broken
// site rather than a quiet upstream. The site's honesty contract already
// says a panel renders its own degraded state instead of a plausible
// blank, so this one now does too — it names the scoreboard and says the
// numbers are syncing.
//
// Night Bench grammar lives in lib/og-bench.tsx. The root also used to
// set `fontFamily: "monospace"` for the WHOLE card, which is the mono
// house-voice the design language bans; mono is now only on the figures,
// which is the rule (if it ticks, it is mono).
import { ImageResponse } from "next/og";
import { getMarketSnapshot } from "@/lib/market";
import { TREASURY_META } from "@/lib/treasuries";
import { OgGalaxyPin } from "@/lib/og-galaxy-pin";
import {
  benchFonts,
  BENCH,
  BenchBrand,
  BenchFooter,
  BenchPanel,
  LiveDot,
  benchRoot,
  body,
  display,
  microLabel,
  readout,
} from "@/lib/og-bench";

export const alt = "Treasuries · Bitcoin's public mNAV scoreboard · Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

// Discount vs premium is a real semantic on this page (cyan = trading
// under the value of its bitcoin, accent = rich premium), so this pair
// survives the accent-discipline pass. It is a reading, not decoration.
const COOL_BLUE = "#7EC0FF";

export default async function Image() {
  const snapshot = await getMarketSnapshot();
  const rows = snapshot.treasuries
    .filter((r) => r.mNAV != null)
    .sort((a, b) => (a.mNAV ?? 0) - (b.mNAV ?? 0));
  const cheapest = rows[0];
  const cheapestMeta = cheapest ? TREASURY_META[cheapest.ticker] : null;
  const top4 = rows.slice(0, 4);
  const live = cheapest != null && cheapest.mNAV != null;

  return new ImageResponse(
    (
      <div style={benchRoot(60)}>
        <BenchBrand
          mark={<OgGalaxyPin size={38} />}
          right={<div style={microLabel(18)}>mNAV scoreboard</div>}
        />

        {live ? (
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: 16,
              marginTop: 18,
            }}
          >
            {/* The cheapest treasury is the card's reading, so it is the one
                object the bench lamp falls on. */}
            <BenchPanel lamp radius={18} padding={22}>
              <div style={microLabel(16, COOL_BLUE)}>Cheapest right now</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 20,
                  marginTop: 12,
                }}
              >
                <span style={display(46)}>{cheapest.ticker}</span>
                <span style={{ ...body(22), display: "flex" }}>
                  {cheapestMeta?.name ?? cheapest.ticker}
                </span>
                <span
                  style={{
                    ...readout(62, cheapest.mNAV! < 1 ? COOL_BLUE : BENCH.accent),
                    marginLeft: "auto",
                  }}
                >
                  {cheapest.mNAV!.toFixed(2)}x
                </span>
              </div>
              <div style={{ ...body(18), marginTop: 6 }}>
                {cheapest.mNAV! < 1
                  ? `${((1 - cheapest.mNAV!) * 100).toFixed(0)}% below the value of its bitcoin`
                  : `${((cheapest.mNAV! - 1) * 100).toFixed(0)}% premium to NAV`}
              </div>
            </BenchPanel>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={microLabel(14)}>Live ranking, cheapest first</div>
              {top4.map((r, i) => {
                const meta = TREASURY_META[r.ticker];
                const mNav = r.mNAV ?? 0;
                const isCheap = mNav < 1;
                return (
                  <div
                    key={r.ticker}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 16,
                      padding: "7px 14px",
                      background: i === 0 ? "rgba(126,192,255,0.06)" : BENCH.panel,
                      border: `1px solid ${i === 0 ? COOL_BLUE : BENCH.hairline}`,
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ ...readout(21), width: 86 }}>{r.ticker}</span>
                    <span style={{ ...body(18), flex: 1 }}>
                      {meta?.name ?? r.ticker}
                    </span>
                    <span style={readout(23, isCheap ? COOL_BLUE : BENCH.accent)}>
                      {mNav.toFixed(2)}x
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* DEGRADED. Say so, and still say what the page is — never ship
             an empty rectangle as the artwork for a shared link. */
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              justifyContent: "center",
              gap: 22,
            }}
          >
            <div style={{ ...display(64), maxWidth: 1000 }}>
              What you actually pay for a treasury&rsquo;s bitcoin.
            </div>
            <div style={{ ...body(27), maxWidth: 940 }}>
              Every public bitcoin treasury ranked by mNAV, gross and net of
              senior debt, updated daily.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              {snapshot.treasuries.map((r) => (
                <BenchPanel
                  key={r.ticker}
                  radius={10}
                  padding={0}
                  style={{
                    paddingTop: 10,
                    paddingBottom: 10,
                    paddingLeft: 18,
                    paddingRight: 18,
                  }}
                >
                  <div style={readout(24, BENCH.inkMuted)}>{r.ticker}</div>
                </BenchPanel>
              ))}
            </div>
          </div>
        )}

        <BenchFooter
          url="galaxymind.space/treasuries"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <LiveDot color={live ? BENCH.accent : BENCH.inkFaint} />
              <span style={microLabel(16, BENCH.inkMuted)}>
                {live ? "Live mNAV" : "mNAV syncing"}
              </span>
            </div>
          }
        />
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
