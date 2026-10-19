"use client";

/* =====================================================================
 * SubmitSuccessCrossSell · "while you wait" cross-sell surface for
 * the /submit success screen
 *
 * Why: the submit success state is a high-intent moment. The visitor
 * has just spent 2-5 minutes filling a form · they're paying attention,
 * they're engaged with Galaxy Mind specifically (not just visiting
 * from a tweet). The default "thanks, check out / or /stack" message
 * wastes that attention as plain text.
 *
 * This component replaces that paragraph with:
 *   1. A small "while you wait" cross-sell card pointing at /stack
 *      (the gauge is the engagement-heavy daily-check surface)
 *   2. A "see who else is here" strip showing the 4 newest vendors
 *      (so the submitter sees what good company looks like and
 *      the cards their entry will become)
 *
 * Mobile-first: stacks cleanly on iPhone, keeps the success affordance
 * (✓ Submission received) as the visual hierarchy peak.
 *
 * No new dependencies, no analytics events (the parent SubmitForm
 * already tracks the submission itself).
 * ===================================================================== */

import Link from "next/link";
import {
  VENDORS,
  vendorSlug,
  vendorKey,
  isNew,
  getDisplayHandle,
  type Vendor,
} from "@/lib/vendors";

const MAX_PEERS = 4;

function pickRecentlyAdded(): Vendor[] {
  // Sort by addedAt desc, prefer NEW (within last 14d) but fall back to
  // recency if there aren't enough new ones. This way the "see who
  // else is here" pills feel current — every visitor sees roughly the
  // current "what's new" set, matching the broader site's freshness
  // signal.
  const sorted = [...VENDORS].sort((a, b) => b.addedAt - a.addedAt);
  const newOnes = sorted.filter((v) => isNew(v));
  if (newOnes.length >= MAX_PEERS) return newOnes.slice(0, MAX_PEERS);
  // Top up with the rest of the most-recent list.
  const filled = [...newOnes];
  for (const v of sorted) {
    if (filled.length >= MAX_PEERS) break;
    if (!filled.some((f) => vendorKey(f) === vendorKey(v))) filled.push(v);
  }
  return filled.slice(0, MAX_PEERS);
}

export function SubmitSuccessCrossSell() {
  const peers = pickRecentlyAdded();

  return (
    <div className="mt-6 space-y-5">
      {/* The rent-hashrate card that led this screen was REMOVED
          2026-08-13. This renders immediately after a merchant submits
          their business, so the first thing they saw on joining the
          directory was an upsell into our own paid product. A directory
          that sells to the merchants it lists is the exact shape a
          neutrality reviewer looks for. While-you-wait cross-sell to
          /stack leads now · the engagement-dense surface most likely to
          turn this submitter into a return visitor. */}
      <Link
        href="/stack"
        className="group block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/40 p-4 transition-all"
      >
        <div className="t-xs font-medium text-[var(--accent-ink)] mb-1.5">
          ⌬ While you wait
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors">
              The Bitcoin Buying Gauge
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-snug">
              10 weighted signals → today&apos;s score 0-100. Dial moves
              daily. Free, no signup.
            </div>
          </div>
          <span
            aria-hidden
            className="font-mono text-sm text-[var(--accent-ink)] shrink-0"
          >
            →
          </span>
        </div>
      </Link>

      {/* Peer-vendor strip · shows submitter what good vendor cards look
          like and gives them a one-tap browse-through into the directory
          (high-value because they're now invested in the platform). */}
      {peers.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            🟢 Recently added · see who else is here
          </div>
          <ul className="grid grid-cols-2 gap-2">
            {peers.map((v) => (
              <li key={vendorKey(v)}>
                <Link
                  href={`/v/${vendorSlug(v)}`}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 hover:bg-[var(--bg-elevated-2)] hover:border-[var(--accent)]/40 transition-colors group min-w-0"
                  title={`${v.name} · ${getDisplayHandle(v)}`}
                >
                  <span className="text-xs text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] truncate transition-colors">
                    {v.name}
                  </span>
                  {isNew(v) && (
                    <span className="shrink-0 t-xs font-medium text-[var(--accent-ink)]">
                      ★ NEW
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/"
            className="mt-3 inline-flex items-baseline gap-1 t-xs text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            See all {VENDORS.length} vendors →
          </Link>
        </div>
      )}
    </div>
  );
}
