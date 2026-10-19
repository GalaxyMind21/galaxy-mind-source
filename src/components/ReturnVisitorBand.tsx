"use client";

/* =====================================================================
 * ReturnVisitorBand · homepage ABOVE-THE-GRID return hooks (2026-07-23)
 *
 * Sits between the hero and the filter controls. LastVisitPulse
 * self-gates on localStorage, so first-timers still see nothing.
 *
 * Arcade dailies used to ride here ("N dailies open · keep the streak").
 * Stripped 2026-08-24: a bitcoin.org Shop-online referral is not asked
 * to keep a streak. PLAY stays in the bottom nav. Footprint + continue-
 * browsing chips came off the same day — the catalog is the first view.
 * ===================================================================== */

import { LastVisitPulse } from "@/components/LastVisitPulse";

export function ReturnVisitorBand() {
  return (
    <div data-return-visitor-band className="mb-5 sm:mb-7">
      <LastVisitPulse />
    </div>
  );
}
