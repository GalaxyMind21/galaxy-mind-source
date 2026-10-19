// Dynamic OG image for the homepage (vendor directory). Renders to PNG via
// `next/og` so X/Discord/iMessage previews show vendor count + categories
// instead of a bare text card. No live data — relies only on the vendor
// list at build time. Re-built when the deploy ships (vendor changes).
//
// THIS CARD IS ~50 URLs, not one: `OG_DIRECTORY` in lib/og.ts points the
// whole spend/directory family here, including the money page and all 26
// vendor hubs. It is the most-unfurled artwork the site has.
//
// Night Bench grammar comes from lib/og-bench.tsx — read the header there
// before re-tuning anything here.
import { ImageResponse } from "next/og";
import { VENDORS } from "@/lib/vendors";
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
} from "@/lib/og-bench";

export const runtime = "nodejs";
// Descriptive alt (competitor teardown lesson A7, 2026-10-18): screen readers
// and link unfurls get what the card shows, not just the brand name.
export const alt =
  "Galaxy Mind share card: a free, human-verified directory of online shops that take bitcoin, with shop and country counts. Buy from people, not platforms.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Re-render on next deploy at minimum; intra-deploy stable.
export const revalidate = 3600;

export default function Image() {
  const categoryCount = new Set(VENDORS.map((v) => v.category)).size;
  // Country count replaces the old 'Bitcoin only' rail count — that
  // distinction was dropped from the directory in May 2026 because it
  // was noise (the page's whole premise is 'they take bitcoin'; rail
  // is plumbing). Country diversity is a more interesting stat.
  const countryCount = new Set(
    VENDORS.map((v) => v.country).filter(Boolean),
  ).size;

  return new ImageResponse(
    (
      <div style={benchRoot(60)}>
        {/* Brand. Avoiding the ₿ Unicode glyph here · Satori (next/og) tries
            to fetch a font on demand for it and that download is unreliable.
            The Imagine enamel pin is the site mark. */}
        <BenchBrand
          mark={<OgGalaxyPin size={38} />}
          right={<div style={microLabel(18)}>Buy from people, not platforms</div>}
        />

        {/* Hero. The count is the card's proof, so it is the ONE object the
            bench lamp falls on. It is warm ink, not accent: the accent is
            reserved for live state, and a build-time vendor count is not
            live state — it is a fact. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 40,
            marginTop: 62,
          }}
        >
          <BenchPanel
            lamp
            radius={24}
            style={{ alignItems: "center", paddingLeft: 40, paddingRight: 40 }}
          >
            <div style={display(132)}>{VENDORS.length}</div>
            <div style={{ ...microLabel(17, BENCH.inkMuted), marginTop: 14 }}>
              Merchants
            </div>
          </BenchPanel>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
            <div style={display(58)}>
              Online shops that take bitcoin at checkout.
            </div>
          </div>
        </div>

        <div style={{ ...body(27), marginTop: 30 }}>
          {`Confirmed by a person, not scraped. ${categoryCount} categories across ${countryCount} countries.`}
        </div>

        {/* Spacer */}
        <div style={{ display: "flex", flex: 1 }} />

        <BenchFooter
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <LiveDot />
              <span style={microLabel(17, BENCH.inkMuted)}>Verified listings</span>
            </div>
          }
        />
      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
