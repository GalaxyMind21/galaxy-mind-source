"use client";

/* =====================================================================
 * VendorMapLazy · client shim so VendorMap loads with ssr:false
 * (perf audit 2026-07-25). Same pattern as FloatTrendChartLazy and
 * /fit's BacktestChart.
 *
 * WHY THIS MATTERS MORE HERE THAN A NORMAL LAZY-LOAD:
 *
 * VendorMap renders src/lib/world-paths.json as a single SVG `d=`
 * attribute. Measured on the live homepage (2026-07-25):
 *
 *   · that ONE attribute is 77,782 of the page's 623,515 HTML bytes
 *   · homepage HTML brotli: 71,229 B with it, 38,218 B without
 *     → the below-fold map was 46% of the homepage's HTML wire size
 *   · the same data ALSO ships as its own ~33 KB brotli JS chunk
 *
 * And per the accepted "CSP > HTML caching" decision (the README), the
 * per-request nonce makes homepage HTML uncacheable at the CDN — so
 * that HTML cost is paid on EVERY view, never amortized. Inlined SVG
 * geometry is therefore much more expensive on this site than the same
 * bytes would be on a CDN-cached one. The JS chunk is cached across
 * views; the HTML never is. That asymmetry is the whole argument.
 *
 * The map sits ~12,000px below the grid it filters (see the call site's
 * scroll-into-view comment), so skipping its SSR markup costs nothing
 * visible, and the swap lands far outside the viewport — it cannot
 * contribute viewport CLS. The skeleton still mirrors the real shell
 * (bezel + header strip + 2:1 map box + footer strip) so the reserved
 * box is right for anyone who scrolls straight down.
 * ===================================================================== */

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { VendorMap } from "./VendorMap";

const Map = dynamic(
  () => import("./VendorMap").then((m) => ({ default: m.VendorMap })),
  {
    ssr: false,
    loading: () => (
      // Mirrors VendorMap's own shell so the reserved box matches.
      <div
        aria-hidden
        className="rounded-xl p-[1.5px] bezel-metal nb-seated"
      >
        <div className="rounded-xl bg-[var(--bg-elevated)] p-4 sm:p-5">
          <div className="flex items-baseline justify-between mb-3 gap-2">
            <div className="micro-label text-[var(--text-tertiary)]">
              Global Reach
            </div>
          </div>
          <div className="w-full aspect-[2/1] rounded-md bg-[var(--bg-elevated-2)]" />
          <div className="mt-3 h-4" />
        </div>
      </div>
    ),
  },
);

export function VendorMapLazy(props: ComponentProps<typeof VendorMap>) {
  return <Map {...props} />;
}
