// GET /api/badge/gauge · shields.io-style live SVG badge for the
// Buying Gauge. Embeddable anywhere an <img> works (GitHub READMEs,
// forums, vendor sites) · every embed is a standing backlink that
// updates itself:
//
//   <img src="https://galaxymind.space/api/badge/gauge" alt="Bitcoin
//        buying gauge score" />
//
// Design notes:
//   · Hand-rolled SVG, no deps · same approach as shields.io flat
//     style. Mono font stack to match the site's instrument voice.
//   · Tier color matches the on-site tier palette (COLD→MOLTEN).
//   · Degraded snapshots render "n/a" rather than the WARM-50
//     fallback · a badge quoting a placeholder as a live score would
//     violate the no-fabrication posture (same honesty contract as
//     DataStatusBanner / the cron gates).
//   · s-maxage=300 + SWR at the CDN · a viral README drives zero
//     upstream traffic beyond one refresh per 5 minutes.
//   · All rendered values are server-derived (score int, tier enum) ·
//     nothing user-controlled flows into the SVG.

import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { computeStackVerdict } from "@/lib/stack";
import { TIER_SCALE_5 } from "@/lib/tier";

export const revalidate = 300;

function badgeSvg(label: string, value: string, color: string): string {
  // Width approximation: 7.2px per char at 12px mono + padding. Good
  // enough across the small fixed vocabulary this badge renders.
  const labelW = Math.round(label.length * 7.2) + 20;
  const valueW = Math.round(value.length * 7.2) + 20;
  const w = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <rect width="${labelW}" height="24" fill="#1C1A16"/>
  <rect x="${labelW}" width="${valueW}" height="24" fill="${color}"/>
  <g fill="#F2EFE9" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12">
    <text x="${labelW / 2}" y="16">${label}</text>
    <text x="${labelW + valueW / 2}" y="16" fill="#12110F" font-weight="bold">${value}</text>
  </g>
</svg>`;
}

export async function GET() {
  try {
    const snapshot = await getMarketSnapshot();
    const degraded = isMarketSnapshotDegraded(snapshot);
    const verdict = computeStackVerdict(snapshot);
    const value = degraded ? "n/a" : `${verdict.score} · ${verdict.tier}`;
    const color = degraded ? "#5C5C66" : (TIER_SCALE_5[verdict.tier] ?? "#F7931A");
    return new NextResponse(badgeSvg("₿ buying gauge", value, color), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (e) {
    console.error(
      "[/api/badge/gauge] unhandled:",
      e instanceof Error ? e.message : e,
    );
    // Even the error path returns a valid badge · a broken-image icon
    // in someone's README reflects on the site worse than a gray n/a.
    return new NextResponse(badgeSvg("₿ buying gauge", "n/a", "#5C5C66"), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  }
}
