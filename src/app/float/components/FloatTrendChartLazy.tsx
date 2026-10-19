"use client";

// Client shim so FloatTrendChart can load with ssr:false — recharts
// (~105 KB gz) was riding in /float's eager bundle because the
// page-level nextDynamic() runs in a server component, where ssr:false
// isn't allowed (perf audit 2026-07-12). Same pattern as /fit's
// BacktestChart. The chart is below-fold, so skipping its SSR markup
// costs nothing visible; the skeleton mirrors the section shell
// (header + h-[260px] chart) so there's no layout shift at swap time.

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { FloatTrendChart } from "./FloatTrendChart";

const Chart = dynamic(
  () =>
    import("./FloatTrendChart").then((m) => ({
      default: m.FloatTrendChart,
    })),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              The Float Over Time
            </h2>
            <p className="text-xs text-[var(--text-tertiary)]">
              Bitcoin still up for grabs, yet to be mined or bought · halving events marked
            </p>
          </div>
        </header>
        <div className="micro-label h-[260px] flex items-center justify-center text-[var(--text-tertiary)]">
          Loading chart…
        </div>
      </section>
    ),
  },
);

export function FloatTrendChartLazy(
  props: ComponentProps<typeof FloatTrendChart>,
) {
  return <Chart {...props} />;
}
