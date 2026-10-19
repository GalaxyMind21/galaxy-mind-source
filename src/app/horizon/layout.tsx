import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { pageOgImage } from "@/lib/og";

const TITLE = "Timechain · the one-tap block stacker · Galaxy Mind";
const DESCRIPTION =
  "Stack the timechain one tap at a time. Every 21 blocks the reward halves and the chain speeds up · bank the most sats before your chain is orphaned.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Without this the root layout's homepage canonical is inherited and
  // the page tells Google it's a duplicate of / (checked by
  // scripts/check-canonicals.ts).
  alternates: { canonical: "https://galaxymind.space/horizon" },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: "https://galaxymind.space/horizon",
    images: pageOgImage("/horizon/opengraph-image", "Timechain · the one-tap block stacker"),
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function HorizonLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
        {children}
      </main>
    </>
  );
}
