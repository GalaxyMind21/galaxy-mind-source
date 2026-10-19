// /stack — Bitcoin Buying Gauge.
//
// Page-level architecture:
// - This component is SYNCHRONOUS — no top-level await on the snapshot.
// - The static shell (header + title + subtitle) renders at TTFB (~30ms).
// - The data-dependent body (gauge + thesis + history + heatmap +
//   signals + calculator + alert form + how-it-works) lives inside
//   <StackContent /> which is awaited inside a <Suspense> boundary.
//   Vercel streams the resolved HTML in once getMarketSnapshot()
//   resolves, replacing <StackSkeleton />.
//
// Why this matters:
// Previously, the entire page awaited getMarketSnapshot() at the top.
// On a cache miss, the user saw a blank page for up to 12 seconds while
// 7-8 external APIs (Yahoo, OKX, CoinGecko, Coinmetrics, etc.) all had
// to resolve before ANY HTML streamed. This pattern is the canonical
// "RSC + Suspense" fix: shell first, slow data later.

import type { Metadata } from "next";
import { Suspense } from "react";
import { BlockHeartbeat } from "./components/BlockHeartbeat";
import { BlockHeightTicker } from "@/components/BlockHeightTicker";
import { StackContent } from "./components/StackContent";
import { StackSkeleton } from "./components/StackSkeleton";
import { SiteHeader } from "@/components/SiteHeader";
import { kvList } from "@/lib/kv";
import type { StackSnapshot } from "@/app/api/cron/snapshot-stack/route";

export const revalidate = 120;

// Per-verdict shareable OG. When ShareVerdictButton emits a URL like
// /stack?s=87&t=MOLTEN&d=2026-05-10, this generateMetadata routes
// social-media scrapers (Twitter, Facebook, iMessage, Slack) at the
// dedicated snapshot OG renderer at /api/og/stack — so the shared
// card stays a moment-in-time even though /stack itself shows the
// live score when the link is clicked.
//
// Integrity: title/description only claim a score when (date, score,
// tier) matches stack:history — same gate as /api/og/stack. Fabricated
// ?s=12&t=COLD without a verified date must not mint a social title.
const SITE_URL = "https://galaxymind.space";
const VALID_TIERS = new Set(["COLD", "CHILL", "WARM", "HOT", "MOLTEN"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const sRaw = typeof sp.s === "string" ? sp.s : null;
  const tRaw = typeof sp.t === "string" ? sp.t : null;
  const dRaw = typeof sp.d === "string" ? sp.d : null;

  const score =
    sRaw !== null && /^\d{1,3}$/.test(sRaw)
      ? Math.max(0, Math.min(100, Number.parseInt(sRaw, 10)))
      : null;
  const tier = tRaw && VALID_TIERS.has(tRaw) ? tRaw : null;
  const date = dRaw && DATE_RE.test(dRaw) ? dRaw : null;

  // No valid snapshot params → layout defaults + opengraph-image.tsx.
  if (score === null || tier === null || date === null) return {};

  // History gate · fail closed (same as /api/og/stack).
  try {
    const history = await kvList<StackSnapshot>("stack:history", 365);
    const real = history.find((h) => h.date === date);
    if (!real || real.score !== score || real.tier !== tier) {
      return {};
    }
  } catch {
    return {};
  }

  const ogParams = new URLSearchParams({
    s: String(score),
    t: tier,
    d: date,
  });
  const ogUrl = `${SITE_URL}/api/og/stack?${ogParams.toString()}`;

  const tierLabelMap: Record<string, string> = {
    COLD: "HOLD",
    CHILL: "STACK SMALL",
    WARM: "STACK",
    HOT: "STACK NOW",
    MOLTEN: "STACK HUGE",
  };
  const tierLabel = tierLabelMap[tier] ?? tier;
  const title = `Bitcoin Buying Gauge: ${score}/100 · ${tierLabel}`;
  const description = `Snapshot from ${date}. The live verdict updates daily. See the current reading at galaxymind.space/stack.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/stack`,
      siteName: "Galaxy Mind",
      type: "website",
      images: [{ url: ogUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: "@GalaxyMind",
      images: [{ url: ogUrl, alt: title }],
    },
  };
}

export default function StackPage() {
  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <BlockHeartbeat>
        <SiteHeader />

        <div className="mx-auto max-w-4xl px-6 pt-6 sm:pt-10 pb-16">
          {/* CENTRED, like /float. The instrument family splits two ways
              and this page was straddling it: /treasuries and /hashrate
              are two-column dashboards and run a left axis, while /float
              and this page are ONE large instrument and run a centred one.
              The h1 and lede were left while the spot price, the gauge
              caption, the verdict and the cockpit below them were all
              centred — three axes stacked down a single page. The block
              ticker becomes the eyebrow rather than a right-hand orphan
              floating in the margin. */}
          <div className="flex flex-col items-center text-center">
            <div className="hidden sm:block mb-2">
              <BlockHeightTicker />
            </div>
            <h1 className="display-title">
              The Bitcoin Buying Gauge
            </h1>
          </div>
          <p className="night-bench-lede mx-auto text-center">
            {/* Tightened 2026-05-21 audit · was 3 sentences/~6 mobile
                lines, pushing the gauge below the fold even with the
                BTC price hero correctly positioned above. The "no
                guessing, no opinions" framing was nice-to-have but
                the page itself communicates that. */}
            <strong className="text-[var(--accent-ink)]">Should you buy bitcoin right now?</strong>{" "}
            Ten on-chain + market signals scored 0–100 · higher = better entry.
          </p>

          {/* Suspense boundary · server streams in StackContent's HTML
              once getMarketSnapshot() resolves. Until then, the
              skeleton stands in. Critical for perceived perf: shell
              paints at ~100ms, gauge appears whenever upstreams resolve
              (typically 1-3s, capped at ~5s by AbortSignal.timeout). */}
          <Suspense fallback={<StackSkeleton />}>
            <StackContent />
          </Suspense>
        </div>
      </BlockHeartbeat>
    </main>
  );
}
