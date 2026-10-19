/* =====================================================================
 * DataStatusBanner · "some feeds are down" honesty strip
 *
 * The ONE calm-orange honesty treatment for degraded / best-effort data
 * across the instrument pages, so nobody trusts a placeholder WARM-50
 * verdict, an mNAV table with silent holes, or a baseline float number
 * during an upstream outage (pentest 2026-06-01 M1 residual, closed
 * 2026-06-10). Consolidated 2026-07-13 (UX audit · B5d): /float used to
 * hand-roll its own fallback/partial pills in a slightly different
 * shape/voice — they now route through this component so the calm-orange
 * honesty voice is identical everywhere.
 *
 * Default gate: rendered while the market snapshot is degraded (≥4 of
 * the 8 weight-bearing signals null per lib/snapshot-quality.ts · the
 * same threshold that blocks the crons). Pages with a distinct data
 * state (e.g. /float's isFallback / partial-cohort day) pass their own
 * boolean + `message` and gate it themselves.
 *
 *   variant="bar"  (default) · full-width rounded-lg strip · /stack,
 *                   /treasuries, /fit — a banner above the instrument.
 *   variant="pill" · inline rounded-full chip · /float — tucked under
 *                   the hero copy so it centers with the surrounding
 *                   text instead of spanning the column.
 *
 * Server-safe presentational component · no hooks, no state. Renders
 * nothing when the gate is false, so mounting it unconditionally is
 * free. The ⚠ glyph is supplied here — callers pass copy WITHOUT it.
 * ===================================================================== */

const DEFAULT_MESSAGE =
  "Several market feeds are down · values shown may use best-effort " +
  "neutral fallbacks until upstreams recover";

export function DataStatusBanner({
  degraded,
  message,
  variant = "bar",
}: {
  /** Render gate. Named for its most common source (a degraded market
   *  snapshot) but is just "show this honesty cue when true" — /float
   *  passes its own isFallback / partial state. */
  degraded: boolean;
  /** Override copy (WITHOUT the ⚠). Defaults to the market-feeds text. */
  message?: string;
  /** Full-width bar (default) or inline pill for hero-embedded use. */
  variant?: "bar" | "pill";
}) {
  if (!degraded) return null;
  const text = message ?? DEFAULT_MESSAGE;

  if (variant === "pill") {
    return (
      <div
        role="status"
        className="micro-label mt-3 inline-flex items-baseline gap-1.5 rounded-full border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-1 text-[var(--warning)]"
      >
        <span aria-hidden>⚠</span>
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="micro-label mb-4 flex items-baseline gap-2.5 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2.5 text-[var(--warning)]"
    >
      <span aria-hidden>⚠</span>
      <span>{text}</span>
    </div>
  );
}
