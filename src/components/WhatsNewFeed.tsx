/* =====================================================================
 * WhatsNewFeed · build-time changelog rendered on /about
 *
 * Pure server component · no client JS, no hydration cost. Reads
 * the build-time changelog from src/lib/changelog.ts and renders
 * the most recent N commits as a typed list.
 *
 * Why on /about: visitors landing on /about are evaluating Galaxy
 * Mind's legitimacy. A "we shipped 5 things in the last week" feed
 * is the strongest signal of an active, maintained project · much
 * stronger than a stale "Last updated 2024" footer. AI agents
 * crawling the page see the same momentum signal in the structured
 * markup.
 *
 * Renders nothing if the changelog is empty (graceful fallback when
 * built outside a git repo).
 *
 * Entries are plain text. The source repository is private, so the
 * feed no longer links to it (those links returned 404 for visitors).
 * ===================================================================== */

import { getChangelog } from "@/lib/changelog";

function formatDate(iso: string): string {
  // YYYY-MM-DD → "Mon DD" for compactness · year is implied by
  // recency. Pull the parts directly so we don't need to construct
  // a Date (avoids timezone foot-guns at build time).
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const monthIdx = parseInt(m, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${monthNames[monthIdx]} ${parseInt(d, 10)}`;
}

export function WhatsNewFeed() {
  const entries = getChangelog();
  if (entries.length === 0) return null;

  return (
    <section
      aria-label="Recent changes"
      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div className="t-xs font-medium text-[var(--accent-ink)]">
          ⌬ What&apos;s new
        </div>
      </div>

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.hash}
            className="flex items-baseline gap-3 text-xs leading-relaxed"
          >
            <span className="shrink-0 font-mono t-xs tracking-widest text-[var(--text-tertiary)] tabular-nums min-w-[3.2em]">
              {formatDate(entry.date)}
            </span>
            <span className="text-[var(--text-secondary)] min-w-0">
              {entry.title}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 pt-3 border-t border-[var(--border-subtle)] t-xs text-[var(--text-tertiary)]">
        Auto-updated every deploy · {entries.length} most recent
      </p>
    </section>
  );
}
