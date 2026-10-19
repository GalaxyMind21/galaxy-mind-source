/**
 * 90-day mNAV sparkline. Renders a tiny SVG line chart of historical
 * premium-to-NAV for a treasury company, with a horizontal reference
 * at 1.0× (NAV) and color coding by current value (orange when above
 * NAV, blue when below).
 *
 * The story this visualizes is *premium compression vs expansion over
 * time* — when treasury equity goes from 1.5× to 0.9× over 90 days,
 * the line drops below the NAV reference and turns icy blue. That's
 * the moment the gauge on /stack starts glowing.
 */
const COOL_BLUE = "var(--cool-ink)";
const ACCENT = "#F7931A";
const NAV_LINE_COLOR = "rgba(255,255,255,0.25)";

const W = 88;
const H = 28;
// Y-axis range for the sparkline. Same clamp as the MNavBar so the
// vertical scale matches the bar visual on the same row.
const Y_MIN = 0.5;
const Y_MAX = 2.0;
// CRITICAL: must match the project() function's coordinate convention.
// project() maps higher mNAV → smaller y (SVG y=0 is top). The previous
// formula `((1.0 - Y_MIN) / (Y_MAX - Y_MIN)) * H` measured distance from
// the BOTTOM, putting the NAV line near the top of the canvas — so a
// treasury at 1.3× mNAV visually appeared BELOW the NAV line when it
// should appear above. The H - prefix corrects to match project().
const NAV_Y = H - ((1.0 - Y_MIN) / (Y_MAX - Y_MIN)) * H;

function project(value: number): number {
  // Map mNAV value to SVG y-coord. Higher mNAV = higher up = smaller y.
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, value));
  const t = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
  return H - t * H;
}

export function MNavSparkline({
  history,
  currentMNav,
}: {
  history: number[] | null;
  currentMNav: number | null;
}) {
  if (!history || history.length < 2) {
    return (
      <div
        className="opacity-40 font-mono t-xs text-[var(--text-tertiary)]"
        style={{ width: W, height: H }}
        aria-hidden
      >
        no history
      </div>
    );
  }

  const stepX = W / (history.length - 1);
  // Build the polyline points string.
  const points = history.map((v, i) => `${(i * stepX).toFixed(2)},${project(v).toFixed(2)}`).join(" ");
  // Build a closed area-fill path (line down to bottom) for subtle
  // gradient infill below the trace.
  const lastX = (history.length - 1) * stepX;
  const areaPath =
    `M 0 ${project(history[0]).toFixed(2)} ` +
    history
      .map((v, i) => `L ${(i * stepX).toFixed(2)} ${project(v).toFixed(2)}`)
      .join(" ") +
    ` L ${lastX.toFixed(2)} ${H} L 0 ${H} Z`;

  // Color by current value (matches the row's mNAV cell color so the
  // visual chain — number → bar → sparkline — stays cohesive).
  const isCheap = currentMNav != null && currentMNav < 1.0;
  const lineColor = isCheap ? COOL_BLUE : ACCENT;
  const areaColor = isCheap
    ? "rgba(126,192,255,0.15)"
    : "rgba(247,147,26,0.15)";

  // Trend direction over the visible window (first vs last point).
  const delta = history[history.length - 1] - history[0];
  const trendArrow = delta > 0.05 ? "↑" : delta < -0.05 ? "↓" : "→";
  const trendColor =
    delta > 0.05 ? ACCENT : delta < -0.05 ? COOL_BLUE : "var(--text-tertiary)";

  return (
    <div
      className="inline-flex items-center gap-1.5"
      title={`${history.length}-day mNAV history`}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: "visible" }}
      >
        {/* Subtle area fill under the line */}
        <path d={areaPath} fill={areaColor} />
        {/* The 1.0× NAV reference line */}
        <line
          x1="0"
          x2={W}
          y1={NAV_Y}
          y2={NAV_Y}
          stroke={NAV_LINE_COLOR}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        {/* The trace itself */}
        <polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 2px ${lineColor})` }}
        />
        {/* Endpoint dot · current value */}
        <circle
          cx={lastX}
          cy={project(history[history.length - 1])}
          r="1.8"
          fill={lineColor}
          style={{ filter: `drop-shadow(0 0 3px ${lineColor})` }}
        />
      </svg>
      <span
        className="micro-label"
        style={{ color: trendColor }}
        aria-label={`90-day trend: ${trendArrow}`}
      >
        {trendArrow}
      </span>
    </div>
  );
}

/**
 * Derive a per-day mNAV time series from raw inputs:
 *   • dailyStockPrices — N days of stock closes
 *   • dailyBtcPrices — N days of BTC closes
 *   • currentMarketCapM — current market cap (millions)
 *   • currentPrice — current stock price
 *   • currentBtcHoldings — BTC the company holds (treated as constant)
 *
 * Approximation: shares_outstanding ≈ currentMarketCap / currentPrice
 * (treats shares as constant — roughly true over 90 days, though
 * aggressive issuers like Strategy will have meaningful drift).
 *
 * historical_market_cap[i] = stock_price[i] * shares
 * historical_mNAV[i]       = historical_market_cap[i] / (btc_holdings * btc_price[i])
 */
export function deriveMNavHistory(
  dailyStockPrices: number[] | null,
  dailyBtcPrices: number[] | null,
  currentMarketCapM: number | null,
  currentPrice: number | null,
  currentBtcHoldings: number | null,
): number[] | null {
  if (
    !dailyStockPrices ||
    !dailyBtcPrices ||
    currentMarketCapM == null ||
    currentPrice == null ||
    currentBtcHoldings == null ||
    currentPrice <= 0 ||
    currentBtcHoldings <= 0
  ) {
    return null;
  }
  const sharesOutstanding = (currentMarketCapM * 1_000_000) / currentPrice;

  // Align lengths — Yahoo can return slightly different sample counts
  // for different tickers. Use the shorter length and align from the
  // RIGHT (newest-aligned) so the most-recent points line up.
  const n = Math.min(dailyStockPrices.length, dailyBtcPrices.length);
  if (n < 5) return null;
  const stocks = dailyStockPrices.slice(-n);
  const btcs = dailyBtcPrices.slice(-n);

  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const marketCap = stocks[i] * sharesOutstanding;
    const navUsd = currentBtcHoldings * btcs[i];
    if (navUsd > 0) result.push(marketCap / navUsd);
  }
  return result.length >= 5 ? result : null;
}
