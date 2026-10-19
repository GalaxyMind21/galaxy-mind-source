/**
 * Daily cron · observe every vendor, queue only what CHANGED.
 *
 * This never writes `verifiedAt`. That field is publicly defined as the
 * date a human last confirmed the merchant, and the whole point of this
 * job is to keep that claim true while removing the manual sweep that
 * used to be the only way to honour it.
 *
 * Storage is ONE hash (field per listing key · slug), written with a single batched
 * HSET rather than one call per vendor, so a run of any size costs
 * exactly 3 KV commands: 1 HMGET (read the baseline) + 1 HSET (write
 * every field back in one call) + 1 SET (the review queue). Upstash
 * free tier is 10K/day.
 */
import { NextResponse } from "next/server";
import { VENDORS, vendorKey } from "@/lib/vendors";
import { probeAll } from "@/lib/vendor-probe";
import {
  buildRun,
  hasUnnotifiedEntries,
  pruneNotified,
  SIGNALS_KEY,
  QUEUE_KEY,
  NOTIFIED_KEY,
} from "@/lib/vendor-queue";
import { signalKey, type VendorSignals } from "@/lib/vendor-signals";
import { kvGet, kvHMGetChecked, kvHSetMany, kvSet, isKvConfigured } from "@/lib/kv";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { renderVendorReviewEmail, sendTransactionalEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;
  // Cron liveness · record right after auth, same convention as every
  // other cron (see lib/cron-health.ts's own contract): this timestamp
  // means "the scheduler reached this handler", not "the run succeeded".
  // Recording it only on the success path would make an ordinary probe-
  // failure abort or a transient KV blip look identical to the cron
  // silently falling out of vercel.json — exactly the two failure modes
  // cron-health exists to tell apart.
  await recordCronRun("monitor-vendors");

  if (!isKvConfigured()) {
    return NextResponse.json({ ok: false, skipped: "kv-unconfigured" });
  }

  // Hash fields are LISTING KEYS (slugs) since 2026-10 · one handle may
  // run several shops and each storefront has its own probe baseline.
  // Baselines written before the move sit under the handle field, so
  // ONE HMGET reads both (keys first, then handles) and a missing key
  // falls back to its handle's legacy record, re-tagged with the key.
  // Still one command; the legacy fields simply stop being rewritten.
  const keys = VENDORS.map((v) => vendorKey(v));
  const handles = VENDORS.map((v) => v.handle);
  const read = await kvHMGetChecked<VendorSignals>(SIGNALS_KEY, [
    ...keys,
    ...handles,
  ]);
  if (!read.ok) {
    // Distinguishing a READ FAILURE from an absent baseline matters: on a
    // transient KV blip every vendor would look new, every diff would be
    // empty, and we would overwrite a good baseline with a blind one.
    console.error("[monitor-vendors] KV read failed · aborting");
    return NextResponse.json({ ok: false, error: "kv-read-failed" }, { status: 503 });
  }
  // The legacy fallback applies only to a handle that owns ONE listing:
  // its record was that shop's. A sibling added later must start fresh,
  // never inherit another storefront's stale baseline.
  const n = VENDORS.length;
  const listingsPerHandle = new Map<string, number>();
  for (const h of handles) listingsPerHandle.set(h, (listingsPerHandle.get(h) ?? 0) + 1);
  const prev: VendorSignals[] = [];
  for (let i = 0; i < n; i++) {
    const byKey = read.values[i];
    const legacy = read.values[n + i];
    if (byKey) prev.push(byKey);
    else if (legacy && listingsPerHandle.get(handles[i]) === 1) {
      prev.push({ ...legacy, key: keys[i] });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const observed = await probeAll(VENDORS, now);
  const run = buildRun(prev, observed);

  if (run.aborted) {
    console.error(
      `[monitor-vendors] ${(run.failRatio * 100).toFixed(0)}% of probes failed · treating as our-side outage, nothing written`,
    );
    return NextResponse.json(
      { ok: false, error: "probe-failure-ratio", failRatio: run.failRatio },
      { status: 503 },
    );
  }

  // ONE HSET for the whole batch — see the file header. A loop of
  // per-vendor kvHSet calls previously turned this into 130 commands.
  const byKey: Record<string, VendorSignals> = {};
  for (const s of run.toStore) byKey[signalKey(s)] = s;
  await kvHSetMany(SIGNALS_KEY, byKey);

  // Captured, not just awaited: `--queue` reads this key directly, so a
  // failed write silently leaves it holding whatever an EARLIER run wrote
  // (stale, or nothing) while this run reports success. Logged here and
  // reflected in the response below rather than treated as a clean run.
  const queueWritten = await kvSet(QUEUE_KEY, run.queue);
  if (!queueWritten) {
    console.error(
      "[monitor-vendors] queue write failed · gm:vendor:review-queue was NOT updated this run",
    );
  }

  // Skip-on-empty · see the note on renderVendorReviewEmail. Skip-on-
  // ALREADY-NOTIFIED is the other half: `QUEUE_KEY` is rewritten wholesale
  // every run and `shouldQueue` re-queues on the streak alone, so without
  // this check a vendor that has been down for a week re-sends an
  // identical email every single night. NOTIFIED_KEY holds the handles
  // already emailed about as of the last SUCCESSFUL send; only a handle
  // that isn't in it yet counts as something to notify about tonight.
  // Same high-water-mark shape as new-vendor-digest's KV baseline.
  let emailed = false;
  let emailError: string | undefined;
  // Read the marker unconditionally: it has to be PRUNED every run, not
  // only on the runs that send. A handle that resolves has to leave the
  // marker, or its next independent incident looks already-notified and
  // sends nothing.
  const notified = (await kvGet<string[]>(NOTIFIED_KEY)) ?? [];
  if (run.queue.length > 0 && process.env.SUBMISSION_NOTIFY_EMAIL) {
    if (hasUnnotifiedEntries(run.queue, notified)) {
      const { subject, html } = renderVendorReviewEmail(run.queue);
      // Operational alert to the operator's own inbox, not a subscriber
      // broadcast — sendAlertBatch attaches List-Unsubscribe headers
      // minted for subscriber alerts, and an accidental one-click
      // unsubscribe here would silently remove SUBMISSION_NOTIFY_EMAIL
      // from the alerts audience and stop the operator's OWN monitoring
      // mail. Same primitive list-pending-submissions uses for its digest.
      const send = await sendTransactionalEmail({
        to: process.env.SUBMISSION_NOTIFY_EMAIL,
        subject,
        html,
      });
      if (send.ok) {
        emailed = true;
      } else {
        emailError = send.error;
        console.error(
          `[monitor-vendors] review-digest email failed · ${send.error}`,
        );
      }
    }
  }

  // Persist the pruned marker EVERY run. `emailed` folds tonight's queue
  // in when a send actually happened; a failed send leaves those handles
  // out so tomorrow retries them rather than losing them.
  await kvSet(NOTIFIED_KEY, pruneNotified(notified, run.queue, emailed));

  return NextResponse.json({
    ok: queueWritten,
    observed: observed.length,
    queued: run.queue.length,
    queue: run.queue,
    emailed,
    ...(queueWritten ? {} : { queueWriteFailed: true }),
    ...(emailError ? { emailError } : {}),
  });
}
