// Shared tier vocabulary · single home for the things that were
// re-inlined across surfaces (consolidation 2026-06-13).
//
// IMPORTANT · there are THREE distinct tier-keyed maps in this
// codebase, and they are deliberately different. Do not "merge" them:
//
//   1. TIER_LABEL (lives in lib/stack.ts) · the GAUGE-ZONE names
//      printed on the dial itself: HODL / DCA / STACK SATS / SEND IT
//      / FULL SEND. Tied to the instrument's voice.
//
//   2. TIER_VERDICT (here) · the VERDICT-ACTION names used on share
//      cards, OG images, and catalyst pages: HOLD / STACK SMALL /
//      STACK / STACK NOW / STACK HUGE. This map was copy-pasted
//      identically into og/stack, should-i-buy, is-it-too-late, and
//      DailyPulse · now imported from here so a wording change is
//      one edit, not four.
//
//   3. Tier COLORS · genuinely surface-specific and NOT unified:
//      - TIER_SCALE_5 (here) · the full five-step data-viz scale the
//        SVG badge uses (cool blue → amber → red).
//      - The /stack history sparkline uses its own greyer band
//        palette (WARM is neutral grey there, not amber) so the trail
//        reads against the chart grid · intentional, stays local.
//      - The OG card uses a 3-bucket accent/blue/border scheme for
//        legibility at billboard scale · intentional, stays local.
//      Forcing those into one map would change rendered output and
//      couple unrelated surfaces. The review that requested this
//      consolidation (2026-06-11) explicitly flagged the palettes as
//      per-surface by design.

import type { StackTier } from "./stack";

/** Verdict-action labels · share cards, OG, catalyst pages. Distinct
 *  from lib/stack.ts TIER_LABEL (the gauge-zone names). */
export const TIER_VERDICT: Record<StackTier, string> = {
  COLD: "HOLD",
  CHILL: "STACK SMALL",
  WARM: "STACK",
  HOT: "STACK NOW",
  MOLTEN: "STACK HUGE",
};

/** Five-step tier color scale · the SVG badge's data-viz palette
 *  (cool blue at COLD through red at MOLTEN). Other surfaces have
 *  their own deliberate palettes · see the header note. */
export const TIER_SCALE_5: Record<StackTier, string> = {
  COLD: "#60A5FA",
  CHILL: "#7DD3FC",
  WARM: "#FBBF24",
  HOT: "#F7931A",
  MOLTEN: "#EF4444",
};
