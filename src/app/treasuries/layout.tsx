import type { Metadata } from "next";
import { OG_TREASURY } from "@/lib/og";

// Title rewritten 2026-10-12 for GSC striking-distance "asst mnav" +
// prior 2026-05-25 query-intent matching · "Treasuries"
// alone is too generic (Google sees it competing with US Treasury
// bonds). "Bitcoin Treasury Companies · mNAV Tracker" matches the
// actual queries people search ("MSTR mNAV", "bitcoin treasury
// companies", "twenty one capital bitcoin"). 55 chars · safe under
// Google's truncation edge.
const TITLE = "Bitcoin Treasury mNAV · MSTR, ASST, XXI, Metaplanet · Galaxy Mind";
const DESCRIPTION =
  "Live ASST, MSTR, XXI and Metaplanet mNAV scoreboard. See which bitcoin treasury company trades cheapest vs the BTC it holds, updated daily.";
const URL = "https://galaxymind.space/treasuries";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: "Bitcoin Treasury mNAV · MSTR, ASST, XXI, Metaplanet",
    description:
      "Live ASST, MSTR, XXI and Metaplanet mNAV. See which bitcoin treasury trades cheapest vs its BTC.",
    url: URL,
    siteName: "Galaxy Mind",
    type: "website",
    images: OG_TREASURY,
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin Treasury mNAV · MSTR, ASST, XXI, Metaplanet",
    description:
      "Live ASST, MSTR, XXI and Metaplanet mNAV. See which bitcoin treasury trades cheapest vs its BTC.",
    creator: "@GalaxyMind",
  },
  alternates: {
    canonical: URL,
  },
};

// NOTE: JSON-LD structured data USED TO live here, but a layout's
// markup renders on EVERY child route, which meant /treasuries/MSTR
// (and the other ticker pages) emitted TWO FAQPage schemas · one
// from this layout, one from the per-ticker page · which Google's
// rich-results validator rejects ("Duplicate field FAQPage", 2026-05-29).
// The umbrella-page schemas (WebApplication + Dataset + FAQPage) now
// live in src/app/treasuries/page.tsx so they render ONLY on
// /treasuries. Per-ticker pages keep their own ticker-specific
// FAQPage. Net result: every URL emits exactly one FAQPage, GSC is
// happy, and the SEO value is preserved on the umbrella URL where
// it correctly described the page in the first place.
//
// This layout is kept (rather than deleted) to anchor the metadata
// export above · Next.js layout metadata is inherited by /treasuries
// (which doesn't define its own) while per-ticker pages override via
// their generateMetadata.

export default function TreasuriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
