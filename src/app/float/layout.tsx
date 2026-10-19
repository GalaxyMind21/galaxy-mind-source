import type { Metadata } from "next";

const URL_ = "https://galaxymind.space/float";

export const metadata: Metadata = {
  title: "How Much Bitcoin Is Left to Buy? · Galaxy Mind",
  description:
    "How much bitcoin is left to buy? A live tracker of the in-play float, the holder-cohort breakdown, and a halving-runway projection. Updated daily.",
  // Without this the root layout's homepage canonical is inherited and
  // the page tells Google it's a duplicate of / (checked by
  // scripts/check-canonicals.ts).
  alternates: { canonical: URL_ },
  openGraph: {
    type: "website",
    title: "The Bitcoin Float",
    description: "How much bitcoin is left to buy · live tracker with halving runway projection.",
    url: URL_,
    // alt filled (competitor teardown lesson A7, 2026-10-18): the bare URL
    // form shipped og:image with no og:image:alt or twitter:image:alt.
    images: [
      {
        url: "/api/og/float",
        width: 1200,
        height: 630,
        alt: "The Bitcoin Float card from Galaxy Mind: how much bitcoin is still in play, its share of the 21 million cap, and the change since yesterday.",
      },
    ],
  },
};

export default function FloatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
