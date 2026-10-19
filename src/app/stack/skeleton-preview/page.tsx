// /stack/_skeleton — preview route showing the StackSkeleton in
// isolation, no Suspense, no real-content swap-in. Useful for
// verifying the animations + layout look right without having to
// race against the data fetch.
//
// `noindex` so search engines don't pick it up; the route is a
// developer/QA aid, not user-facing surface area. The underscore
// prefix on the segment is a common convention to signal "internal
// preview, not part of the public IA."

import type { Metadata } from "next";
import { StackSkeleton } from "../components/StackSkeleton";

export const metadata: Metadata = {
  title: "Stack skeleton preview · Galaxy Mind",
  robots: { index: false, follow: false },
};

export default function StackSkeletonPreviewPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <header className="max-w-4xl mx-auto px-6 pt-6 pb-2">
        <a href="/stack" className="micro-label text-[var(--text-tertiary)] hover:text-[var(--accent-ink)]">
          ← back to /stack
        </a>
      </header>

      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
        <h1 className="text-2xl font-semibold mb-2">Skeleton preview</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-2">
          This is what users see during the cold-cache load on /stack.
          All animations are pure CSS · they begin the moment the HTML
          renders, no JS needed.
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mb-8">
          Reload the page to replay the animation from the start.
        </p>

        <StackSkeleton />
      </div>
    </main>
  );
}
