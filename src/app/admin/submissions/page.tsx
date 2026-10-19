import type { Metadata } from "next";
import Link from "next/link";
import { AdminSubmissionsClient } from "./AdminSubmissionsClient";

export const metadata: Metadata = {
  title: "Submission queue · Operator",
  robots: { index: false, follow: false },
};

/**
 * Operator-only moderation UI for the vendor submission queue.
 * Auth is ADMIN_SECRET entered in-browser (React state only) and
 * sent as Bearer to the existing /api/admin/* routes. No secret is
 * baked into the page. Approve still requires a local vendors.ts
 * write via the CLI for the git side of the house — this UI is the
 * fast triage layer (view / reject / mark-approved after CLI write).
 */
export default function AdminSubmissionsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-2 font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)]">
          Operator · ADMIN_SECRET gated
        </div>
        <h1 className="display-title mb-2">
          Submission <span className="headline-gradient">queue</span>
        </h1>
        <p className="mb-4 max-w-xl text-sm text-[var(--text-secondary)]">
          Fast triage for the moderation queue.{" "}
          <strong className="font-normal text-[var(--text-primary)]">
            Reject
          </strong>{" "}
          is complete here.{" "}
          <strong className="font-normal text-[var(--text-primary)]">
            Approve
          </strong>{" "}
          must use the CLI so vendors.ts is written + validated + committed:
          <code className="mt-2 block rounded bg-[var(--bg-elevated-2)] px-2 py-1.5 font-mono text-xs text-[var(--accent-ink)]">
            CRON_SECRET=… npx tsx scripts/review-submissions.ts
          </code>
          Use &quot;Mark approved (KV only)&quot; only after that write so
          the queue entry does not linger.
        </p>
        <p className="mb-8 font-mono t-xs text-[var(--text-tertiary)]">
          <Link
            href="/admin/review-queue"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            Vendor review queue
          </Link>
          {" "}
          · nightly monitor flags, not submissions
        </p>
        <AdminSubmissionsClient />
      </div>
    </main>
  );
}
