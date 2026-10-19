// Cron liveness tracking · gives the operator one place to see whether
// every scheduled Vercel cron is still firing, without digging
// through the Vercel dashboard or logs. Recommended by the 2026-06-01
// pen test ("cron health observability").
//
// Semantics · we record "last FIRED", not "last succeeded": each cron
// calls recordCronRun() right after its auth check passes, so the
// timestamp means "the scheduler reached this handler". That is the
// highest-value signal · it catches the scary failure mode where a
// cron silently stops being scheduled (removed from vercel.json, a
// Vercel cron incident, a renamed path). A cron that fires but errors
// is a different problem that surfaces in the function logs / its 500
// response; this endpoint is about "is it firing at all".
//
// Storage · one KV key per cron (`cron:last:<slug>`) holding the unix
// ms of the last fire, with a TTL longer than any interval so a
// long-dead cron reads as "never / stale" rather than lingering.

import { kvGet, kvSet } from "./kv";

const PREFIX = "cron:last:";
// 120 days · comfortably longer than the longest interval (weekly) so a
// genuinely-stopped cron's key expires to null (read as stale) instead
// of showing an ancient timestamp forever.
const TTL_SECONDS = 60 * 60 * 24 * 120;

// Every scheduled cron (slugs match the folder under app/api/cron/
// and the path in vercel.json) plus its expected cadence. Daily crons
// should fire every 24h; weekly crons every 168h. monthly-roundup runs
// on a weekly cron trigger (it self-gates to the first Sunday in its
// own logic), so for *firing* purposes it is weekly.
// vercel.json ⊆ this list is asserted by scripts/check-cron-meta.ts
// (in `npm run verify`) · a cron added to vercel.json without an entry
// here would be invisible to /api/admin/cron-health forever.
export const CRON_META: { name: string; expectedIntervalHours: number }[] = [
  { name: "check-thresholds", expectedIntervalHours: 24 },
  { name: "snapshot-stack", expectedIntervalHours: 24 },
  { name: "snapshot-treasuries", expectedIntervalHours: 24 },
  { name: "snapshot-float", expectedIntervalHours: 24 },
  { name: "snapshot-hashrate", expectedIntervalHours: 24 },
  { name: "snapshot-filings", expectedIntervalHours: 24 },
  { name: "audit-vendor-activity", expectedIntervalHours: 24 },
  { name: "social-post-drafts", expectedIntervalHours: 24 },
  { name: "wen-drop", expectedIntervalHours: 24 },
  { name: "list-pending-submissions", expectedIntervalHours: 24 },
  { name: "monitor-vendors", expectedIntervalHours: 24 },
  { name: "hashrate-available", expectedIntervalHours: 1 },
  { name: "rentals-sweep", expectedIntervalHours: 1 },
  { name: "weekly-digest", expectedIntervalHours: 168 },
  { name: "weekly-pulse", expectedIntervalHours: 168 },
  { name: "new-vendor-digest", expectedIntervalHours: 168 },
  { name: "check-fit-changes", expectedIntervalHours: 168 },
  { name: "monthly-roundup", expectedIntervalHours: 168 },
];

/**
 * Record that a cron fired. Best-effort · wrapped so health bookkeeping
 * can never throw and break the cron itself. Call right after the auth
 * check passes.
 */
export async function recordCronRun(name: string): Promise<void> {
  try {
    await kvSet(PREFIX + name, Date.now(), TTL_SECONDS);
  } catch {
    // Swallow · a failed health write must not affect the cron's work.
  }
}

export type CronStatus = {
  name: string;
  expectedIntervalHours: number;
  /** Unix ms of the last recorded fire, or null if never seen / expired. */
  lastRun: number | null;
  /** Seconds since the last fire, or null if never seen. */
  ageSeconds: number | null;
  /** True when overdue: no record, or age > 1.5× the expected interval. */
  stale: boolean;
};

/**
 * Read the last-fire timestamp for every known cron and flag the
 * overdue ones. `nowMs` is passed in so the caller's asOf and the age
 * math share a single clock reading.
 */
export async function getAllCronStatuses(nowMs: number): Promise<CronStatus[]> {
  return Promise.all(
    CRON_META.map(async (m) => {
      const ts = await kvGet<number>(PREFIX + m.name);
      const lastRun = typeof ts === "number" && Number.isFinite(ts) ? ts : null;
      const ageSeconds =
        lastRun != null ? Math.max(0, Math.round((nowMs - lastRun) / 1000)) : null;
      // 1.5× the cadence is the grace window · a daily cron is "stale"
      // only after ~36h, absorbing normal scheduler jitter without
      // false alarms.
      const staleThresholdSeconds = m.expectedIntervalHours * 3600 * 1.5;
      const stale = ageSeconds == null || ageSeconds > staleThresholdSeconds;
      return {
        name: m.name,
        expectedIntervalHours: m.expectedIntervalHours,
        lastRun,
        ageSeconds,
        stale,
      };
    }),
  );
}
