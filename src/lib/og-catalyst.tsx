// Shared Open Graph card for the SEO catalyst pages (mstr-vs-bitcoin,
// cheapest-bitcoin-treasury, should-i-buy-bitcoin, is-it-too-late-to-
// buy-bitcoin, ibit-vs-mstr, and six more). Each page's
// opengraph-image.tsx is a thin wrapper that supplies an eyebrow + title
// + subtitle and re-exports the size/contentType constants; the visual
// treatment lives here so the social cards stay consistent and DRY.
//
// ELEVEN CARDS RENDER THROUGH THIS FUNCTION. It is the single highest-
// leverage file in the OG set after the root card.
//
// Night Bench grammar (2026-09-10) comes from lib/og-bench.tsx. Before
// this, the card carried the pre-rollout cockpit treatment: an ORANGE
// corner bloom for a ground, `GALAXY MIND` in mono at 0.30em where the
// site header says "Galaxy Mind" in sentence case, a weight-800 title
// against the site's own weight-500 display type, and a cold `#26262C`
// rule with cold `#5C5C66` ink under it. Read og-bench.tsx's header
// before re-tuning any of it.
//
// Satori (next/og) caveats, learned the hard way on the homepage card:
//   • No ₿ Unicode glyph · Satori tries to fetch a font on demand for
//     it and that download is flaky. Use the Imagine enamel-pin mark.
//   • System fonts only (ui-sans-serif / ui-monospace) · no remote
//     font loading, and Satori cannot read the .woff2 the site face ships as.
//   • Every flex container needs an explicit display:flex — including
//     any node with more than one child, which a wrapped headline is.
import { ImageResponse } from "next/og";
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

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";
// Re-render on next deploy at minimum; intra-deploy stable (no live data
// in the card · the page bodies carry the live numbers).
export const OG_REVALIDATE = 3600;

export type CatalystOgProps = {
  /** Small uppercase kicker above the title (e.g. "Treasury comparison"). */
  eyebrow: string;
  /** The headline · keep it to the page's core question/claim. */
  title: string;
  /** One supporting line under the title. */
  subtitle: string;
  /** Optional right-aligned footer tagline (defaults to a generic CTA). */
  footerTag?: string;
};

/**
 * Render a catalyst page's social card to PNG. Call this from a page's
 * `opengraph-image.tsx` default export.
 */
export function renderCatalystOg({
  eyebrow,
  title,
  subtitle,
  footerTag = "Live data · open methodology",
}: CatalystOgProps) {
  return new ImageResponse(
    (
      <div style={benchRoot(60)}>
        <BenchBrand mark={<OgGalaxyPin size={38} />} />

        {/* Hero. The eyebrow is the seated object the bench lamp falls on —
            a small lit chip rather than the old accent-orange tracked-out
            kicker. Accent stays reserved for the live dot in the footer. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 22,
            marginTop: 58,
          }}
        >
          <BenchPanel
            lamp
            radius={12}
            padding={0}
            style={{ paddingTop: 12, paddingBottom: 12, paddingLeft: 20, paddingRight: 20 }}
          >
            <div style={microLabel(17, BENCH.inkMuted)}>{eyebrow}</div>
          </BenchPanel>

          <div style={{ ...display(72), maxWidth: 1040 }}>{title}</div>

          <div style={{ ...body(29), maxWidth: 1000, marginTop: 2 }}>{subtitle}</div>
        </div>

        {/* Spacer */}
        <div style={{ display: "flex", flex: 1 }} />

        <BenchFooter
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <LiveDot />
              {/* The wrappers' taglines end in "→" from the old card, where
                  the arrow WAS the affordance. The live dot carries that now,
                  so the arrow is just noise — stripped here rather than in
                  eleven call sites. */}
              <span style={microLabel(16, BENCH.inkMuted)}>
                {footerTag.replace(/\s*→\s*$/, "")}
              </span>
            </div>
          }
        />
      </div>
    ),
    { ...OG_SIZE, fonts: benchFonts() },
  );
}
