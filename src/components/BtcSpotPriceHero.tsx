// Shared BTC spot-price callout · three size variants for the three
// pages that need it. The page-audit (2026-05-20) found that BTC
// spot price has zero or buried above-fold presence on /stack,
// /float, AND /treasuries-on-mobile · this single component
// standardizes the fix so the casual visitor's "what's bitcoin
// worth right now" question is answered at the same visual
// register everywhere.
//
// Sizes:
//   "lg"     · /stack hero · 5xl/6xl mono number, full prominence
//   "md"     · /treasuries header · 3xl/4xl, paired w/ LIVE pulse
//   "inline" · /float reservoir card · single-line "≈ $X spot"
//             complement to the centerpiece "X BTC LEFT TO BUY"
//
// Server-compatible: no useState/useEffect/hooks so it works inside
// the streamed StackContent SSR pass AND the static /treasuries SSR
// pass without a client-component boundary. Graceful null: if price
// is missing (degraded snapshot), the component renders nothing
// rather than showing "—" or "$0" — the surrounding layout collapses
// cleanly.
//
// The price FIGURE is the one interactive leaf · SpotPriceNumber is a
// small client child that flips the sitewide USD↔sats unit pref on
// click (2026-06-10). The boundary lives there, not here, so this
// component stays server-pure and deriveBtc24hDelta stays importable
// from server components.

import { SpotPriceNumber } from "@/components/SpotPriceNumber";

type Size = "lg" | "md" | "inline";

type Props = {
  price: number | null | undefined;
  // Signed % change over the last 24h (e.g., -2.3 for down 2.3%).
  // Optional; when omitted the delta chip doesn't render. Callers
  // compute this from hourlyCloses upstream so the component stays
  // a pure presenter (no time-window math here).
  delta24h?: number | null;
  size: Size;
  // Override the default eyebrow label · e.g. /treasuries might want
  // "BTC SPOT · ANCHORS THE TABLE" to explain why it matters there.
  label?: string;
};

// Compact dollar format · $112,847 not $112,847.00 (cents are noise
// at this magnitude). Locale-en for the comma separator since this
// is a US-centric site (Resend audience metadata is mostly NA).
function formatPrice(price: number): string {
  return `$${Math.round(price).toLocaleString("en-US")}`;
}

function formatDelta(d: number): string {
  const sign = d > 0 ? "+" : "";
  // 1 decimal place · enough precision to distinguish meaningful
  // moves (0.5% vs 1.5%) without false-precision noise.
  return `${sign}${d.toFixed(1)}%`;
}

export function BtcSpotPriceHero({
  price,
  delta24h,
  size,
  label = "BTC SPOT · LIVE",
}: Props) {
  if (price == null || !Number.isFinite(price)) return null;

  // Per-variant class bundles · keeping them inline (vs. a sizeMap)
  // so Tailwind's JIT scanner picks up every class literally.
  if (size === "inline") {
    // Single-line complement · meant to sit immediately below the
    // /float "X BTC LEFT TO BUY" big number. Lower-key than the
    // hero variants since the centerpiece is the BTC count, not USD.
    return (
      <div className="font-mono text-[12px] sm:text-[13px] tracking-wide text-[var(--text-secondary)] mt-1">
        <span className="text-[var(--text-tertiary)]">at </span>
        <SpotPriceNumber
          price={price}
          className="text-[var(--accent-ink)] font-semibold tabular-nums"
        />
        <span className="text-[var(--text-tertiary)]"> spot</span>
        {delta24h != null && Number.isFinite(delta24h) ? (
          <span
            className={`ml-2 tabular-nums ${
              delta24h > 0
                ? "text-[var(--success)]"
                : delta24h < 0
                  ? "text-[var(--warning)]"
                  : "text-[var(--text-tertiary)]"
            }`}
            aria-label={`24-hour change ${formatDelta(delta24h)}`}
          >
            {formatDelta(delta24h)} 24h
          </span>
        ) : null}
      </div>
    );
  }

  const isLg = size === "lg";
  // lg → centered, max-w container, generous spacing for /stack hero
  // md → left-aligned compact for /treasuries header strip
  const containerCls = isLg
    ? // lg mobile footprint trimmed (mobile audit 2026-06-20): my-6→my-3
      // and the number 5xl→4xl below, so the /stack gauge clears the
      // fold by ~50-60px on a 375px screen. Desktop (sm+) unchanged.
      "flex flex-col items-center text-center my-3 sm:my-8"
    : "flex flex-col items-start text-left my-4";
  const numberCls = isLg
    ? "font-mono text-4xl sm:text-6xl text-[var(--accent-ink)] font-semibold tracking-tight tabular-nums leading-none"
    : "font-mono text-3xl sm:text-4xl text-[var(--accent-ink)] font-semibold tracking-tight tabular-nums leading-none";
  const labelCls = isLg
    ? "font-mono text-[10px] sm:text-[11px] tracking-[0.3em] uppercase text-[var(--text-tertiary)] mb-2"
    : "font-mono t-xs tracking-[0.28em] uppercase text-[var(--text-tertiary)] mb-1.5";

  return (
    <div
      className={containerCls}
      role="status"
      aria-label={`BTC spot price ${formatPrice(price)}${
        delta24h != null && Number.isFinite(delta24h)
          ? `, 24-hour change ${formatDelta(delta24h)}`
          : ""
      }`}
    >
      <div className={labelCls}>
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] mr-1.5 align-middle animate-pulse"
          aria-hidden
        />
        {label}
      </div>
      <div className="flex items-baseline gap-3 flex-wrap justify-center">
        <SpotPriceNumber price={price} className={numberCls} />
        {delta24h != null && Number.isFinite(delta24h) ? (
          <span
            className={`font-mono text-sm sm:text-base tabular-nums tracking-tight ${
              delta24h > 0
                ? "text-[var(--success)]"
                : delta24h < 0
                  ? "text-[var(--warning)]"
                  : "text-[var(--text-tertiary)]"
            }`}
          >
            {formatDelta(delta24h)}
            <span className="text-[var(--text-tertiary)] ml-1">24h</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Helper for callers that have a MarketSnapshot · derive the 24h
 * delta from the hourlyCloses series so they don't have to remember
 * the lookback index. Returns null when the series is missing or
 * too short. Pure function, server-safe.
 */
export function deriveBtc24hDelta(
  spotPrice: number | null | undefined,
  hourlyCloses: number[] | null | undefined,
): number | null {
  if (spotPrice == null || !Number.isFinite(spotPrice)) return null;
  if (!hourlyCloses || hourlyCloses.length < 25) return null;
  // hourlyCloses is oldest→newest; the close from 24h ago lives at
  // length - 25 (length-1 is the most recent close, length-25 is 24
  // closes earlier · approximately 24 hours).
  const anchor = hourlyCloses[hourlyCloses.length - 25];
  if (anchor == null || anchor <= 0) return null;
  return ((spotPrice - anchor) / anchor) * 100;
}
