import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { RentalTermsBody } from "@/components/RentalTermsBody";
import { RENTAL_TERMS_URL } from "@/lib/rentals/phase2/terms";

// Rental Terms, published 2026-10-16 (operator approved publishing the draft).
// The renter accepts RENTAL_TERMS_VERSION in create_rental; the label on the
// page is derived from that same constant. noindex and kept out of the sitemap.
export const metadata: Metadata = {
  title: "Rental Terms · Galaxy Mind",
  description: "The terms for renting Bitcoin mining rigs from Galaxy Mind.",
  alternates: { canonical: RENTAL_TERMS_URL },
  robots: { index: false, follow: false },
};

export default function RentalTermsPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />
      <RentalTermsBody />
    </main>
  );
}
