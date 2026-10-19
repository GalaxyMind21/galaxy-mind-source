/* =====================================================================
 * MiniSparkline — tiny per-signal trail for the cockpit cards.
 *
 * Pure SVG, no client JS, no animation libs. Takes a series of 0-100
 * normalized values (oldest → newest) and renders a 100×24 sparkline
 * with a faint area-fill underneath. Color matches the signal's
 * direction: orange when ending bullish, cyan when bearish, grey when
 * neutral. Endpoint dot anchors the eye to "today's reading."
 *
 * Renders nothing (returns null) if there's not enough data — UX is
 * "show something useful or get out of the way."
 * ===================================================================== */

const W = 100;
const H = 24;
const PAD_X = 2;
const PAD_Y = 3;

type Props = {
  series: number[];        // values 0–100, oldest → newest
  // Optional override for line color. Defaults to value-based.
  color?: string;
  className?: string;
};

const COOL_BLUE = "#5478b8";
const ICE_GLOW = "var(--cool-ink)";

export function MiniSparkline({ series, color, className = "" }: Props) {
  // Need at least 3 points for the trend to mean something.
  if (!series || series.length < 3) return null;

  const w = W - PAD_X * 2;
  const h = H - PAD_Y * 2;
  const stepX = series.length > 1 ? w / (series.length - 1) : 0;

  // Build the polyline + area-fill paths.
  const pts = series.map((v, i) => {
    const x = PAD_X + i * stepX;
    // Invert Y so high score = visually high
    const clamped = Math.max(0, Math.min(100, v));
    const y = PAD_Y + (1 - clamped / 100) * h;
    return { x, y };
  });
  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(2)} ${(H - PAD_Y).toFixed(2)} L ${pts[0].x.toFixed(2)} ${(H - PAD_Y).toFixed(2)} Z`;

  const last = series[series.length - 1];
  const lineColor =
    color ??
    (last >= 65
      ? "var(--accent)"
      : last <= 35
        ? COOL_BLUE
        : "var(--text-tertiary)");
  const areaColor =
    last >= 65
      ? "rgba(247,147,26,0.18)"
      : last <= 35
        ? "rgba(84,120,184,0.18)"
        : "rgba(120,125,135,0.10)";

  const endpointColor =
    last >= 65
      ? "var(--accent)"
      : last <= 35
        ? ICE_GLOW
        : "var(--text-tertiary)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full h-[24px] ${className}`}
      style={{ overflow: "visible" }}
      aria-hidden
    >
      {/* Subtle horizontal mid-line at score=50 · gives the eye a
          baseline to compare against. */}
      <line
        x1={PAD_X}
        y1={PAD_Y + h * 0.5}
        x2={W - PAD_X}
        y2={PAD_Y + h * 0.5}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth="0.5"
        strokeDasharray="1.5 1.5"
      />
      {/* Area fill */}
      <path d={areaPath} fill={areaColor} />
      {/* Sparkline */}
      <path
        d={linePath}
        stroke={lineColor}
        strokeWidth="1.4"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Endpoint dot · anchors "today" */}
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r="2"
        fill={endpointColor}
        style={{ filter: `drop-shadow(0 0 3px ${endpointColor})` }}
      />
    </svg>
  );
}
