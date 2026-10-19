/**
 * vendor-queue · turns one night's observations into (what to store,
 * who to wake the operator about). Pure, so the abort guard and the
 * streak arithmetic are testable without KV.
 */
import {
  diffSignals,
  nextFailStreak,
  shouldQueue,
  ABORT_FAIL_RATIO,
  signalKey,
  type VendorSignals,
} from "@/lib/vendor-signals";

export const SIGNALS_KEY = "gm:vendor:signals";
export const QUEUE_KEY = "gm:vendor:review-queue";
/**
 * Handles the digest has already emailed about, from the last run that
 * successfully sent. Lets the cron notify on CHANGE rather than on
 * non-empty state — see `hasUnnotifiedEntries` below.
 */
export const NOTIFIED_KEY = "gm:vendor:review-notified";

/**
 * A ratio alone is statistically meaningless on a tiny batch: with one
 * vendor observed, a single `gone` probe is already 100% — far past
 * ABORT_FAIL_RATIO — even though one dead shop says nothing about our
 * own egress. Require an absolute floor of gone probes before the ratio
 * check can fire at all. At production scale (~130 vendors) this floor
 * is irrelevant — 30% of the roster is dozens of vendors — so it only
 * guards small/edge-case runs from tripping on noise.
 */
const MIN_GONE_FOR_ABORT = 2;

export type QueueEntry = {
  handle: string;
  /** Listing key (slug) since 2026-10 · absent on older stored queues,
   *  where the handle alone identifies the (then only) listing. */
  key?: string;
  reason: string;
  priority: "high" | "normal";
};

/**
 * Defensive parse of `QUEUE_KEY`. The cron writes a well-typed array,
 * but this is what the operator UI reads, so a corrupt or half-written
 * value must degrade to empty rather than throw through the page.
 */
/** Listing identity of a queue entry (falls back to the handle on
 *  entries stored before 2026-10). */
export function queueKey(e: Pick<QueueEntry, "key" | "handle">): string {
  return e.key ?? e.handle;
}

export function parseQueue(raw: unknown): QueueEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: QueueEntry[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.handle !== "string" || e.handle.length === 0) continue;
    if (typeof e.reason !== "string") continue;
    if (e.priority !== "high" && e.priority !== "normal") continue;
    out.push({
      handle: e.handle,
      ...(typeof e.key === "string" && e.key.length > 0 ? { key: e.key } : {}),
      reason: e.reason,
      priority: e.priority,
    });
  }
  return out;
}

export type RunResult = {
  aborted: boolean;
  failRatio: number;
  toStore: VendorSignals[];
  queue: QueueEntry[];
};

export function buildRun(
  prev: VendorSignals[],
  observed: VendorSignals[],
): RunResult {
  // Baselines match by listing key; a pre-2026-10 baseline (no `key`)
  // matches by handle, which the caller maps onto the listing key.
  const byKey = new Map(prev.map((p) => [signalKey(p), p]));

  // Abort guard: a `gone` share above the threshold means our egress is
  // broken, not that a third of the roster died overnight. Writing a
  // baseline in that state would poison every future diff.
  const goneCount = observed.filter(
    (o) => o.shop?.kind === "gone" || o.profile?.kind === "gone",
  ).length;
  const failRatio = observed.length ? goneCount / observed.length : 0;
  if (goneCount >= MIN_GONE_FOR_ABORT && failRatio > ABORT_FAIL_RATIO) {
    return { aborted: true, failRatio, toStore: [], queue: [] };
  }

  const toStore: VendorSignals[] = [];
  const queue: QueueEntry[] = [];

  for (const next of observed) {
    const before = byKey.get(signalKey(next)) ?? null;
    const streak = nextFailStreak(before, next);
    const stored: VendorSignals = { ...next, failStreak: streak };
    toStore.push(stored);

    const changes = diffSignals(before, next);
    const decision = shouldQueue(changes, streak);
    if (decision.queue) {
      queue.push({
        handle: next.handle,
        ...(next.key ? { key: next.key } : {}),
        reason: decision.reason,
        priority: decision.priority,
      });
    }
  }

  queue.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1));
  return { aborted: false, failRatio, toStore, queue };
}

/**
 * True when tonight's queue contains at least one handle that was NOT in
 * the notified set from the last successful digest send. This is what
 * "email on CHANGE" means in practice: `QUEUE_KEY` is rewritten wholesale
 * every run and `shouldQueue` re-queues on the streak alone, so without
 * this check a genuinely-dead vendor re-sends an identical email every
 * night until the operator edits vendors.ts — the exact alert-fatigue
 * failure `new-vendor-digest` and `list-pending-submissions` both guard
 * against with their own KV high-water marks.
 */
export function hasUnnotifiedEntries(
  queue: QueueEntry[],
  notified: string[],
): boolean {
  // Markers hold listing keys since 2026-10; a pre-move marker holds the
  // handle, which still counts as notified for that entry.
  const seen = new Set(notified);
  return queue.some((e) => !seen.has(queueKey(e)) && !seen.has(e.handle));
}

/**
 * The notified marker, pruned to what is still queued.
 *
 * `hasUnnotifiedEntries` suppresses a repeat email for a handle we have
 * already told the operator about. That is only correct while the handle
 * is STILL in trouble. Before this existed the marker was rewritten only
 * on a successful send, so:
 *
 *   - a queue that went empty skipped the whole block and left the marker
 *     populated forever, and
 *   - a handle that resolved while another stayed queued was never pruned,
 *     because the remaining handle was already notified so no send ran.
 *
 * Either way the handle's NEXT, independent incident looked
 * already-notified and sent nothing. Pruning every run to the handles
 * currently queued means a resolved vendor drops out immediately, so a
 * later recurrence is genuinely new again. `sent` folds tonight's queue in
 * when an email actually went out.
 */
export function pruneNotified(
  notified: string[],
  queue: QueueEntry[],
  sent: boolean,
): string[] {
  // Legacy handle markers are carried over onto the entry's listing key
  // so the move to keys never re-sends an alert already delivered.
  const current = new Set(queue.map(queueKey));
  const seen = new Set(notified);
  const kept = queue
    .filter((e) => seen.has(queueKey(e)) || seen.has(e.handle))
    .map(queueKey);
  if (!sent) return [...new Set(kept)];
  return [...new Set([...kept, ...current])];
}
