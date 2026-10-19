// GET /api/badge/vendor/[slug] · per-vendor shop-facing SVG badge
// (2026-06-10). Copy lives in VENDOR_BADGE (lib/vendors.ts) so the
// image, the embed snippet, and the operator handoff cannot drift.
//
// The backlink engine: vendors embed the badge on their own sites
// (the /v/[slug] page shows them the snippet), every embed links back
// to their directory page, and the badge stays honest automatically ·
// it re-renders from the live VENDORS data on each deploy + 1h CDN
// window, so a vendor past the STALE_THRESHOLD_DAYS human-touch
// backstop (see lib/vendors.ts) shows an amber "check listing" state
// instead of a stale green.
//
// All rendered text derives from operator-curated vendors.ts (names
// are sanitized at submission time and human-reviewed before landing
// in the file) · no request data flows into the SVG beyond the slug
// lookup. Unknown slugs get a neutral gray badge (not a 404 image ·
// a broken-image icon on a vendor's site reflects on us).

import { NextRequest, NextResponse } from "next/server";
import { VENDORS, VENDOR_BADGE, isStale, vendorSlug } from "@/lib/vendors";

export const revalidate = 3600;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeSvg(label: string, value: string, color: string): string {
  const labelW = Math.round(label.length * 7.2) + 20;
  const valueW = Math.round(value.length * 7.2) + 20;
  const w = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <title>${esc(label)}: ${esc(value)}</title>
  <rect width="${labelW}" height="24" fill="#1C1A16"/>
  <rect x="${labelW}" width="${valueW}" height="24" fill="${color}"/>
  <g fill="#F2EFE9" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12">
    <text x="${labelW / 2}" y="16">${esc(label)}</text>
    <text x="${labelW + valueW / 2}" y="16" fill="#12110F" font-weight="bold">${esc(value)}</text>
  </g>
</svg>`;
}

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control":
    "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const vendor = VENDORS.find((v) => vendorSlug(v) === slug);
  if (!vendor) {
    return new NextResponse(
      badgeSvg(VENDOR_BADGE.unknownLabel, VENDOR_BADGE.unknownValue, "#5C5C66"),
      { headers: SVG_HEADERS },
    );
  }
  const stale = isStale(vendor.verifiedAt);
  return new NextResponse(
    stale
      ? badgeSvg(VENDOR_BADGE.label, VENDOR_BADGE.stale, "#FB923C")
      : badgeSvg(VENDOR_BADGE.label, VENDOR_BADGE.live, "#F7931A"),
    { headers: SVG_HEADERS },
  );
}
