import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { OG_DIRECTORY } from "@/lib/og";
import { VENDORS, VENDOR_BADGE, getDisplayHandle, vendorSlug } from "@/lib/vendors";
import { BADGE_PAGE_URL } from "@/lib/badge-outreach";
import { BadgeLookup } from "./BadgeLookup";

const TITLE = "Your verified Bitcoin badge · Galaxy Mind";
const DESCRIPTION =
  "Listed on Galaxy Mind? Grab the Accepts Bitcoin Verified badge for your shop. Shoppers click it and land on your listing.";
const URL = BADGE_PAGE_URL;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: URL,
    siteName: "Galaxy Mind",
    images: OG_DIRECTORY,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

export default function BadgePage() {
  const roster = VENDORS.map((v) => ({
    name: v.name,
    handle: v.handle,
    slug: vendorSlug(v),
    display: getDisplayHandle(v),
  }));

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-10 pb-20">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          For listed merchants
        </div>
        <h1
          className="display-title"
          aria-label="Your verified Bitcoin badge"
        >
          Your{" "}
          <span className="headline-gradient">verified</span>
          {" "}
          Bitcoin badge
        </h1>
        <p className="mt-4 text-[var(--text-secondary)] text-base sm:text-lg max-w-2xl leading-relaxed">
          One stamp for your own site. Shoppers see you take bitcoin,
          click it, and land on your Galaxy Mind listing. Free. No
          account.
        </p>

        <div className="mt-8">
          <span
            className="inline-flex overflow-hidden rounded-[4px] font-mono text-[15px] leading-none lit-active"
            aria-hidden="true"
          >
            <span className="bg-[#1C1A16] px-3.5 py-2.5 text-[#F2EFE9]">
              {VENDOR_BADGE.label}
            </span>
            <span className="bg-[var(--accent)] px-3.5 py-2.5 font-bold text-black">
              {VENDOR_BADGE.live}
            </span>
          </span>
        </div>

        <Suspense
          fallback={
            <div className="mt-10 h-64 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
          }
        >
          <BadgeLookup roster={roster} />
        </Suspense>

        <p className="mt-12 t-xs text-[var(--text-tertiary)] leading-relaxed">
          Not listed yet?{" "}
          <Link
            href="/submit"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            Submit your shop
          </Link>
          . We only list after a person confirms a bitcoin payment for
          an actual good.
        </p>
      </div>
    </main>
  );
}
