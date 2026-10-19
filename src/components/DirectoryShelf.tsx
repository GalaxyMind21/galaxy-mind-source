"use client";

import { useState } from "react";
import { track } from "@vercel/analytics";
import { VendorCard } from "@/components/VendorCard";
import { VendorDetailModal } from "@/components/VendorDetailModal";
import { findVendorByKey, vendorKey, type Vendor } from "@/lib/vendors";

/** Night Bench vendor grid — same cell as `/`, for hubs and listicles.
 *  Must pass onOpenDetail: without it VendorCard is preview-mode (name
 *  is text, no crawlable /v link, click is dead). */
export function DirectoryShelf({ vendors }: { vendors: Vendor[] }) {
  // Listing key (slug), not handle: one handle may run several shops.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const shelfIndex = vendors.findIndex((v) => vendorKey(v) === openKey);
  const vendor =
    (shelfIndex >= 0 ? vendors[shelfIndex] : null) ??
    (openKey ? findVendorByKey(openKey) : null);
  const inShelf = shelfIndex >= 0;
  const n = vendors.length;

  function open(v: Vendor, surface: string) {
    setOpenKey(vendorKey(v));
    track("vendor_modal_open", { handle: v.handle, surface });
  }

  return (
    <>
      <div className={n > 0 && n < 4 ? "nb-grid nb-grid-few" : "nb-grid"}>
        {vendors.map((v, i) => (
          <VendorCard
            key={vendorKey(v)}
            vendor={v}
            index={i}
            onOpenDetail={() => open(v, "shelf")}
          />
        ))}
      </div>
      <VendorDetailModal
        vendor={vendor}
        onClose={() => setOpenKey(null)}
        onPrev={
          inShelf && n > 1
            ? () =>
                setOpenKey(vendorKey(vendors[(shelfIndex - 1 + n) % n]))
            : undefined
        }
        onNext={
          inShelf && n > 1
            ? () => setOpenKey(vendorKey(vendors[(shelfIndex + 1) % n]))
            : undefined
        }
        position={
          inShelf ? { index: shelfIndex + 1, total: n } : undefined
        }
        onSelectVendor={(v) => open(v, "shelf_related")}
      />
    </>
  );
}
