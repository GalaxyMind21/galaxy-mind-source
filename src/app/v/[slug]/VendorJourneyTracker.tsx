"use client";

/* =====================================================================
 * VendorJourneyTracker · invisible visit-recorder for /v/[slug]
 *
 * Mounts inside the server-rendered VendorPage and fires recordVisit()
 * exactly once per page mount. Renders nothing · pure side-effect.
 *
 * Why a dedicated component instead of just calling recordVisit
 * inline: VendorPage is a SERVER component (must be · uses async
 * params + KV dormancy lookup), so browser-side LS writes can't live
 * there. This tiny client component is the LS-write bridge.
 *
 * The visit is recorded BEFORE any UI reads from the journey so the
 * homepage's RecentlyViewedVendors strip will include this vendor
 * the next time the user lands on /. Concretely: on this very page
 * the user is already viewing the vendor, so nothing to render
 * differently; the value of recording is for the NEXT pageview.
 * ===================================================================== */

import { useEffect } from "react";
import { recordVisit } from "@/lib/vendor-journey";

/** `vendorKey` is the listing key (slug), not the handle: one handle may
 *  run several shops, and each shop is its own visit. */
export function VendorJourneyTracker({ vendorKey }: { vendorKey: string }) {
  useEffect(() => {
    recordVisit(vendorKey);
  }, [vendorKey]);
  return null;
}
