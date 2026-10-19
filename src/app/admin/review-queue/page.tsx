import type { Metadata } from "next";
import Link from "next/link";
import { AdminReviewQueueClient } from "./AdminReviewQueueClient";

export const metadata: Metadata = {
  title: "Vendor review queue · Operator",
  robots: { index: false, follow: false },
};

/**
 * Operator-only triage for gm:vendor:review-queue (written by the
 * nightly monitor-vendors cron). Auth is ADMIN_SECRET (CRON_SECRET
 * fallback) entered in-browser, same pattern as /admin/submissions.
 * Read-only: verifiedAt only moves via the CLI, and dismiss is not
 * offered because the cron rewrites the key wholesale each night.
 */
export default function AdminReviewQueuePage() {
  return (
    <main className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-2 t-xs font-medium text-[var(--text-tertiary)]">
          Operator · ADMIN_SECRET gated
        </div>
        <h1 className="display-title mb-2">
          Vendor <span className="headline-gradient">review</span>
        </h1>
        <p className="mb-4 max-w-xl text-sm text-[var(--text-secondary)]">
          Read-only view of what last night&apos;s monitor queued. This
          page never writes{" "}
          <code className="font-mono text-xs text-[var(--accent-ink)]">
            verifiedAt
          </code>
          . Re-verify with the CLI; a dismiss button is not offered
          because the cron rewrites{" "}
          <code className="font-mono text-xs text-[var(--accent-ink)]">
            gm:vendor:review-queue
          </code>
          {" "}
          wholesale each run, so an ack here would come back tomorrow.
        </p>
        <p className="mb-8 font-mono t-xs text-[var(--text-tertiary)]">
          <Link
            href="/admin/submissions"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            Submission queue
          </Link>
        </p>
        <AdminReviewQueueClient />
      </div>
    </main>
  );
}
