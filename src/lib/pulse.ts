// Weekly Pulse · a once-a-week snapshot of the whole Bitcoin circular
// economy, composed from the SAME libs the instrument pages render (no
// new upstream calls) and archived to KV so past weeks stay browsable.
//
// /today answers "what changed since yesterday"; the pulse answers
// "what happened this week" and, unlike /today, it PERSISTS — a weekly
// cron writes each week's snapshot to a capped KV list, and /pulse
// renders the live current week plus the archive of prior weeks. The
// archive is the evergreen SEO/retention asset: a dated, linkable
// record of the economy's growth week over week.

import { getMarketSnapshot } from "./market";
import { computeStackVerdict, TIER_LABEL } from "./stack";
import { isMarketSnapshotDegraded } from "./snapshot-quality";
import { getFloatData } from "./float-data";
import { VENDORS, isNewThisWeek } from "./vendors";
import { kvList, kvPushCapped } from "./kv";

export type PulseSnapshot = {
  /** UTC Monday (YYYY-MM-DD) of the week this snapshot covers. */
  weekOf: string;
  /** When the snapshot was composed (ISO). */
  composedAt: string;
  gaugeScore: number | null;
  gaugeTier: string | null;
  inPlayM: number | null; // millions of BTC still in play
  floatWeekDelta: number | null; // BTC that left the float over ~7d (positive = drained)
  cheapestTicker: string | null;
  cheapestMNav: number | null;
  vendorTotal: number;
  countryCount: number;
  newThisWeek: number;
  newThisWeekNames: string[];
};

export const PULSE_ARCHIVE_KEY = "pulse:archive";
const ARCHIVE_CAP = 60; // ~14 months of weekly snapshots

/** UTC Monday of the week containing `now`, as YYYY-MM-DD. */
export function weekOfMonday(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const diff = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** Human label for a weekOf key · "Week of July 7, 2026". */
export function weekLabel(weekOf: string): string {
  const d = new Date(weekOf + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return weekOf;
  return (
    "Week of " +
    d.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  );
}

/**
 * Compose the current week's pulse from live data. Degrades honestly:
 * when the market snapshot or float is unavailable the affected fields
 * are null rather than guessed.
 */
export async function composePulse(now = new Date()): Promise<PulseSnapshot> {
  const [snapshot, float] = await Promise.all([
    getMarketSnapshot(),
    // 8 newest rows · enough for week delta without loading 365 + synthetic.
    getFloatData({ days: 8, synthetic: false }),
  ]);
  const degraded = isMarketSnapshotDegraded(snapshot);
  const verdict = computeStackVerdict(snapshot);

  const cheapest = [...snapshot.treasuries]
    .filter((r) => r.mNAV != null)
    .sort((a, b) => (a.mNAV ?? Infinity) - (b.mNAV ?? Infinity))[0];

  const inPlay = float.isFallback ? null : float.current.inPlay;

  // ~7-day float change · DATE-BOUNDED at both ends (fixed 2026-07-25).
  //
  // This used to be `find(date === D-7) ?? history[7]`. Two ways that
  // published a wrong number under the label "this week":
  //   · The index-7 fallback assumes the history list is dense and
  //     continuous. A single missed snapshot-float cron run makes
  //     history[7] D-8 or older, so a 9- or 10-day drain got reported
  //     as the weekly figure.
  //   · Even the exact-match path only bounds the OLD end. `inPlay` is
  //     history[0], which can itself be stale, so a D-7 → D-3 pair
  //     (4 real days) still printed as "this week".
  // Now: pick the newest snapshot at-or-before D-7, and require BOTH
  // ends to sit in a plausible window. Anything else returns null, which
  // the UI already renders honestly as "building weekly history"
  // (floatWeekLine) rather than as a number.
  const DAY_MS = 86_400_000;
  const tsOf = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const targetWeek = new Date(now);
  targetWeek.setUTCDate(targetWeek.getUTCDate() - 7);
  const weekCutoff = tsOf(targetWeek.toISOString().slice(0, 10));

  const latestSnap = float.history[0] ?? null;
  // history is newest-first, so the first row at/before the cutoff is the
  // newest candidate for "a week ago".
  const weekSnap = float.history.find((h) => tsOf(h.date) <= weekCutoff) ?? null;

  // Fresh ends only: the recent end within ~2 days of now, and the old
  // end within ~3 days of the D-7 target (so 5..10 days back qualifies).
  const nowMs = now.getTime();
  const recentFresh =
    latestSnap != null && nowMs - tsOf(latestSnap.date) <= 2 * DAY_MS;
  const weekFresh =
    weekSnap != null && weekCutoff - tsOf(weekSnap.date) <= 3 * DAY_MS;

  const weekAgo = recentFresh && weekFresh ? weekSnap!.inPlay : null;
  const floatWeekDelta =
    inPlay != null && weekAgo != null ? Math.round(weekAgo - inPlay) : null;

  const nowSec = now.getTime() / 1000;
  const newThisWeekVendors = VENDORS.filter((v) => isNewThisWeek(v, nowSec));
  const countryCount = new Set(
    VENDORS.map((v) => v.country).filter(Boolean),
  ).size;

  return {
    weekOf: weekOfMonday(now),
    composedAt: now.toISOString(),
    gaugeScore: degraded ? null : verdict.score,
    gaugeTier: degraded ? null : TIER_LABEL[verdict.tier],
    inPlayM: inPlay != null ? Math.floor(inPlay / 100_000) / 10 : null,
    floatWeekDelta,
    cheapestTicker: cheapest?.ticker ?? null,
    cheapestMNav: cheapest?.mNAV ?? null,
    vendorTotal: VENDORS.length,
    countryCount,
    newThisWeek: newThisWeekVendors.length,
    newThisWeekNames: newThisWeekVendors
      .sort((a, b) => b.listedAt - a.listedAt)
      .slice(0, 8)
      .map((v) => v.name),
  };
}

/** Prior weekly snapshots, newest-first. Empty when KV is unconfigured. */
export async function readPulseArchive(
  n = ARCHIVE_CAP,
): Promise<PulseSnapshot[]> {
  return kvList<PulseSnapshot>(PULSE_ARCHIVE_KEY, n);
}

/**
 * Append this week's snapshot to the archive, once per week. If the
 * most-recent archived snapshot already covers the same UTC week, this
 * is a no-op · makes a manual cron re-run idempotent.
 */
export async function savePulseSnapshot(
  snap: PulseSnapshot,
): Promise<"saved" | "already_this_week" | "write_failed"> {
  const latest = (await kvList<PulseSnapshot>(PULSE_ARCHIVE_KEY, 1))[0];
  if (latest && latest.weekOf === snap.weekOf) return "already_this_week";
  // Report the write result (fixed 2026-07-25). kvPushCapped returns
  // false on a failed/absent KV write, and this used to be discarded —
  // so the weekly-pulse cron answered ok:true/"saved" while the archive
  // silently never grew. /pulse's dated archive is the evergreen SEO
  // asset; a permanently-empty one would have looked like a content
  // problem, not an infrastructure one. Note kvPushCapped is also false
  // in no-op mode (KV unconfigured), which is the honest answer there
  // too: nothing was archived.
  const ok = await kvPushCapped(PULSE_ARCHIVE_KEY, snap, ARCHIVE_CAP);
  if (!ok) {
    // lib/kv.ts only logs an anonymous `[kv] HTTP nnn` with no key or
    // caller, so name the row here or the operator can't correlate it.
    console.error(
      `[pulse] archive write failed for weekOf=${snap.weekOf} · snapshot NOT persisted`,
    );
    return "write_failed";
  }
  return "saved";
}
