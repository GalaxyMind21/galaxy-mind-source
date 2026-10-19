/* =====================================================================
 * lib/changelog.ts · build-time git log → typed changelog data
 *
 * Reads `git log` at build time (not request time) and exposes a
 * typed array of recent commits to the /about "What's new" feed.
 * Vercel deploys have full git history available during the build,
 * so this works automatically on every push to main.
 *
 * Why build-time:
 *   - Runtime can't access git (deployment artifacts only contain
 *     compiled output, not the .git directory)
 *   - Build-time bakes the data into the static page · no per-request
 *     subprocess overhead, no runtime dependency on git
 *   - Re-runs every deploy, so the feed is always current as of the
 *     last deployment (which is what visitors care about)
 *
 * Failure mode: if git fails (running outside a git repo, git binary
 * missing, etc.), returns an empty array. The /about page renders
 * the "What's new" section conditionally · empty list → section
 * omitted. No build failure.
 *
 * Filtering: hides commits matching the EXCLUDE_TITLE_PATTERNS regex
 * (Co-Authored-By trailers, merge commits, work-in-progress markers)
 * to keep the feed scannable for non-technical visitors.
 *
 * Friendly titles: rewrites raw commit subjects into human-readable
 * one-liners. Strips conventional-commit prefixes like "feat:" / "fix:"
 * and trims over-long subjects.
 *
 * Security: uses execFileSync (NOT execSync) so arguments are passed
 * as an array rather than interpolated into a shell command. No
 * variable input flows into this call but the array form is the
 * safer pattern by default.
 * ===================================================================== */

import { execFileSync } from "node:child_process";

export type ChangelogEntry = {
  /** Short commit hash (7 chars) · used as React key + GitHub link target */
  hash: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  /** Human-readable title (cleaned up from the raw commit subject) */
  title: string;
};

// Skip these so the feed reads cleanly.
const EXCLUDE_TITLE_PATTERNS = [
  /^merge\s/i,
  /^wip[:\s]/i,
  /^revert\s/i,
  /^chore:\s*release/i,
];

// Strip these conventional-commit prefixes from the title for
// readability · the visitor doesn't need to see "feat:" / "fix:".
const PREFIX_STRIP = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci)(\([^)]+\))?:\s*/i;

const MAX_ENTRIES = 12;
const MAX_TITLE_LEN = 90;

/**
 * Fetch the recent git log as typed entries. Runs `git log` once
 * at module-load time (build phase) and caches the result. Returns
 * an empty array on any failure.
 */
let cached: ChangelogEntry[] | null = null;

export function getChangelog(): ChangelogEntry[] {
  if (cached !== null) return cached;

  try {
    // execFileSync avoids the shell · args passed as a separate array
    // so there's no command-injection surface even if any argument
    // were ever to derive from variable input later.
    const raw = execFileSync(
      "git",
      [
        "log",
        "--pretty=format:%h|%ad|%s",
        "--date=short",
        `-n${MAX_ENTRIES * 3}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );

    const out: ChangelogEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [hash, date, ...subjectParts] = line.split("|");
      if (!hash || !date || subjectParts.length === 0) continue;
      const subject = subjectParts.join("|").trim();
      if (EXCLUDE_TITLE_PATTERNS.some((rx) => rx.test(subject))) continue;

      let title = subject.replace(PREFIX_STRIP, "");
      // Cap length with ellipsis so a verbose commit doesn't break
      // the feed layout.
      if (title.length > MAX_TITLE_LEN) {
        title = title.slice(0, MAX_TITLE_LEN - 1).trimEnd() + "…";
      }

      out.push({ hash: hash.trim(), date: date.trim(), title });
      if (out.length >= MAX_ENTRIES) break;
    }
    cached = out;
    return out;
  } catch {
    // Outside a git repo, git not installed, etc. · graceful empty.
    cached = [];
    return cached;
  }
}
