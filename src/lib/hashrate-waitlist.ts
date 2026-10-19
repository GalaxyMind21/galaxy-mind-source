/**
 * When to email the hashrate waitlist.
 *
 * Pure so the rule can be pinned without standing up KV or Resend.
 * The cron stores the last observed openCount and the UTC day of the
 * last send, and calls this on every tick.
 *
 * Send when the open count went up, and at most once per UTC day.
 * A fleet that is never fully rented still frees a machine; the old
 * 0→open rule never fired while any bay was already open.
 *
 * First run (prev == null): record a baseline, send nothing. Deploying
 * this while machines are already open must not blast the list. A flat
 * or falling count sends nothing. An upstream outage that reports zero
 * must not be written as prev (the cron skips this helper when the
 * desk is degraded).
 *
 * `today` and `lastNotifiedDay` are `YYYY-MM-DD` UTC. A missing or
 * unparseable last-sent day does not silence a real rise. A missing
 * today refuses the send.
 */
const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function shouldNotifyHashrateOpen(
  prevOpenCount: number | null,
  nextOpenCount: number,
  lastNotifiedDay: string | null,
  today: string,
): boolean {
  if (prevOpenCount == null) return false;
  if (!Number.isFinite(prevOpenCount) || prevOpenCount < 0) return false;
  if (!Number.isFinite(nextOpenCount) || nextOpenCount < 0) return false;
  if (!UTC_DAY.test(today)) return false;
  if (!(nextOpenCount > prevOpenCount)) return false;
  if (lastNotifiedDay != null && lastNotifiedDay === today) return false;
  return true;
}
