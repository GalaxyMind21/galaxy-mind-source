/**
 * Visual mNAV indicator. A horizontal bar chart anchored at 1.0× (the NAV
 * line — where market cap exactly equals the value of the bitcoin held).
 * Bars to the LEFT of the line = trading below NAV (cheap, blue/icy);
 * bars to the RIGHT = trading above NAV (premium, warm orange).
 *
 * The whole story of this page is "where does each treasury sit relative
 * to the NAV line?" — this is the visual that makes that immediate.
 */
const COOL_BLUE = "var(--cool-ink)";

// Display range for the bar. mNAVs in the wild span roughly 0.7× to 2.5×;
// clamping to 0.5–2.0 keeps the visualization readable while still showing
// the ~85% of the historical distribution.
const MIN = 0.5;
const MAX = 2.0;
// Position of the NAV (1.0×) line as a percentage from the left.
const NAV_POS_PCT = ((1.0 - MIN) / (MAX - MIN)) * 100;

export function MNavBar({ mNav }: { mNav: number | null }) {
  if (mNav == null || !Number.isFinite(mNav)) {
    return (
      <div className="relative w-full h-2.5 rounded-full bg-[var(--border-subtle)]/40 overflow-hidden">
        <span
          className="absolute inset-y-0 w-px bg-[var(--text-tertiary)]"
          style={{ left: `${NAV_POS_PCT}%` }}
          aria-hidden
        />
      </div>
    );
  }

  const clamped = Math.max(MIN, Math.min(MAX, mNav));
  const valuePct = ((clamped - MIN) / (MAX - MIN)) * 100;
  const isCheap = mNav < 1.0;
  const isFair = mNav >= 1.0 && mNav < 1.05;

  // Bar runs from the NAV line to the value position. The narrower side
  // (left or right) decides direction.
  const barLeft = isCheap ? valuePct : NAV_POS_PCT;
  const barWidth = isCheap ? NAV_POS_PCT - valuePct : valuePct - NAV_POS_PCT;

  const fillColor = isCheap
    ? COOL_BLUE
    : isFair
      ? "var(--text-tertiary)"
      : "var(--accent)";
  const glow = isCheap
    ? "0 0 8px rgba(126,192,255,0.5)"
    : isFair
      ? "none"
      : `0 0 8px rgba(247,147,26,0.5)`;

  return (
    <div className="relative w-full h-2.5 rounded-full bg-[var(--bg-elevated-2)] overflow-visible">
      {/* Background track */}
      <div className="absolute inset-0 rounded-full bg-[var(--border-subtle)]/30" />

      {/* The colored bar from NAV line to value */}
      <div
        className="absolute inset-y-0 rounded-full transition-all duration-300"
        style={{
          left: `${barLeft}%`,
          width: `${barWidth}%`,
          background: fillColor,
          boxShadow: glow,
        }}
      />

      {/* NAV line marker (always visible, sits ON TOP of the bar) */}
      <span
        className="absolute -inset-y-1 w-px bg-[var(--text-secondary)]"
        style={{ left: `${NAV_POS_PCT}%` }}
        aria-hidden
      />

      {/* Tick labels below the bar */}
      <div className="micro-label absolute inset-x-0 -bottom-4 flex justify-between text-[var(--text-tertiary)] pointer-events-none">
        <span>0.5×</span>
        <span style={{ marginLeft: `${NAV_POS_PCT - 8}%` }}>NAV</span>
        <span>2.0×</span>
      </div>
    </div>
  );
}
