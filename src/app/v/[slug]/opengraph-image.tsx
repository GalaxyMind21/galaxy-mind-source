// Per-vendor OG image · the social preview that appears when a /v/[slug]
// link is shared on X, Discord, iMessage, Slack, etc.
//
// Each vendor gets a unique 1200x630 PNG with their name, country, and
// category. This is the single biggest distribution lever for the
// vendor flywheel · when a vendor RTs Galaxy Mind's announcement, the
// preview card visitors see is THEIR card on Galaxy Mind, not a
// generic site image.

import { ImageResponse } from "next/og";
import { OgGalaxyPin } from "@/lib/og-galaxy-pin";
import {
  benchFonts,
  BENCH,
  BenchBrand,
  BenchFooter,
  BenchPanel,
  benchRoot,
  body,
  display,
  microLabel,
} from "@/lib/og-bench";
import {
  COUNTRIES,
  CATEGORY_LABELS,
  findVendorBySlug,
  vendorSlug,
  getDisplayHandle,
} from "@/lib/vendors";

// generateImageMetadata emits id: vendorSlug, so Next serves the PNG at
// /v/[slug]/opengraph-image/[id]. page.tsx MUST declare that path (see
// scripts/test-vendor-og-path.ts) or every social unfurl 404s.
export const alt = "Bitcoin vendor on Galaxy Mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 86400; // 1 day · vendor data changes only on commit

// Emit exactly ONE image entry per route · scoped to params.slug.
// Without the params arg, Next called this once per static slug but
// returned the FULL vendor list for each — emitting one og:image meta
// tag per vendor on every page, all but one wrong. The first tag wins
// on social cards, so every vendor's preview showed another vendor's
// image until this scoping landed. Note the asymmetry with the Image
// function below: generateImageMetadata's params is sync (resolved at
// static-render enumeration time), while Image's is a Promise
// (per-request, post-Next-16-async-params).
export function generateImageMetadata({
  params,
}: {
  params: { slug: string };
}) {
  const vendor = findVendorBySlug(params.slug);
  return vendor
    ? [
        {
          id: vendorSlug(vendor),
          alt: `${vendor.name} accepts Bitcoin · Galaxy Mind`,
          size,
          contentType,
        },
      ]
    : [];
}

const ACCENT = BENCH.accent;
const FG_MUTED = BENCH.inkMuted;

// Next 16 made dynamic-route params async · the type MUST be
// Promise<...> and the value MUST be awaited before reading. The
// previous sync type compiled but threw at runtime when production
// requested the OG image, breaking previews on every shared
// /v/[slug] link.
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const vendor = findVendorBySlug(slug);
  if (!vendor) {
    // Fallback card · should not happen because generateImageMetadata
    // limits to known slugs, but defensive in case of stale share
    // links pointing at a removed vendor.
    return new ImageResponse(
      (
        <div style={{ ...benchRoot(60), justifyContent: "center" }}>
          <div style={{ ...display(56), maxWidth: 900 }}>
            A directory of online shops that take bitcoin.
          </div>
          <div style={{ ...body(27), marginTop: 16 }}>galaxymind.space</div>
        </div>
      ),
      { ...size, fonts: benchFonts() },
    );
  }

  const country = vendor.country ? COUNTRIES[vendor.country] : null;
  const displayHandle = getDisplayHandle(vendor);

  return new ImageResponse(
    (
      <div style={benchRoot(60)}>
        {/* Top brand bar. ASCII only: Satori tries to fetch a font for
            ★ / ₿ and that download 400s (449 production errors on this
            route as of 2026-08). Same rule as /api/og/stack. */}
        <BenchBrand
          mark={<OgGalaxyPin size={38} />}
          right={<div style={microLabel(18)}>Verified vendor</div>}
        />

        {/* Vendor name · the headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            marginTop: 22,
          }}
        >
          <BenchPanel lamp radius={20} padding={34}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 26,
              marginBottom: 18,
            }}
          >
            <span style={display(70)}>{vendor.name}</span>
            {country && (
              <span style={{ display: "flex", fontSize: 56, lineHeight: 1 }}>
                {country.flag}
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: ACCENT,
              marginBottom: 14,
            }}
          >
            {displayHandle.length > 50
              ? displayHandle.slice(0, 47) + "…"
              : displayHandle}
          </div>
          <div style={{ ...body(25), maxWidth: 980 }}>
            {vendor.description.length > 180
              ? vendor.description.slice(0, 177) + "…"
              : vendor.description}
          </div>
          </BenchPanel>
        </div>

        {/* Bottom row · category pill + URL */}
        <BenchFooter
          url={`galaxymind.space/v/${vendorSlug(vendor)}`}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <BenchPanel
                radius={999}
                padding={0}
                style={{
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 18,
                  paddingRight: 18,
                }}
              >
                <div style={microLabel(15, BENCH.inkMuted)}>
                  {CATEGORY_LABELS[vendor.category]}
                </div>
              </BenchPanel>
            </div>
          }
        />

      </div>
    ),
    { ...size, fonts: benchFonts() },
  );
}
