// Vendor submission moderation queue · KV-backed.
//
// Lifecycle:
//   1. Vendor fills out /submit form → POSTs /api/submit-vendor
//   2. Endpoint validates + writes to `submission:pending:<id>` in KV
//   3. Operator runs `npx tsx scripts/review-submissions.ts`
//   4. Per submission: approve (writes to vendors.ts + commits) or
//      reject (marks rejected with reason). Either action removes
//      from the pending index.
//
// Why KV-backed (not git-direct):
//   - Spam protection · public form means anyone could submit. KV
//     queue gives the operator final approval before anything lands
//     in the public vendors.ts.
//   - Reversibility · approval can be undone before commit; rejection
//     can be reconsidered.
//   - No GitHub write access needed for the submission API.

import { randomUUID } from "node:crypto";
import type { OutcomeCode } from "./submission-outcomes";
import { kvGet, kvSet, kvList, kvPushCapped } from "./kv";
import type { Vendor } from "./vendors";
import type { LnGuardAssessment } from "./ln-guard";
import type { SubmitFlag } from "./submit-guard";
import type { OwnershipCheck } from "./vendor-dedupe";

// Subset of Vendor fields that submissions can populate. addedAt,
// verifiedAt, and listedAt are NOT submittable · they're computed at
// approval time by the review CLI (a submitter doesn't get to backdate
// their own listing).
export type VendorSubmission = {
  // Random UUID-ish identifier · used as the KV key suffix.
  id: string;
  // Submitted vendor data · all fields except handle/name/description/
  // category are optional, matching the Vendor type.
  vendor: Omit<Vendor, "addedAt" | "verifiedAt" | "listedAt">;
  // Unix seconds when the submission landed.
  submittedAt: number;
  // Optional contact / message from the submitter (free-form).
  // Stored separately so it doesn't end up in vendors.ts.
  submitterNote?: string;
  // Approval state.
  status: "pending" | "approved" | "rejected";
  // If rejected, why · the PRIVATE audit note. Read by the review
  // tooling and by future sessions re-vetting the same handle; it has
  // twice been what revealed a resubmission. NEVER sent to the
  // submitter — it routinely contains probe results and internal
  // judgements ("expect further submissions from this submitter on
  // behalf of paying clients"). The submitter-facing half is `outcome`.
  rejectReason?: string;
  // Structured decision (2026-08-20). `code` selects the pre-written
  // submitter-facing copy and its "what to fix" line from
  // lib/submission-outcomes, and decides whether anyone is told at all
  // (four codes are deliberately silent). `note` is the operator's
  // optional extra sentence, also submitter-facing. Absent on records
  // predating this field — tooling must treat absent as "no structured
  // outcome", never as a notifying one.
  outcome?: {
    code: OutcomeCode;
    note?: string;
    // Unix seconds of a successful send · absent means nobody was told.
    notifiedAt?: number;
  };
  // Once approved, the resulting vendor's addedAt (for traceability).
  approvedAsAddedAt?: number;
  // Content-gate flags from lib/submit-guard (2026-08-23). Hard
  // rejects (gmail-as-X, bait, no bitcoin) never reach KV; this
  // array is for residual risk that was allowed through (e.g.
  // suspicious-host) so a row that slips the door is still loud
  // in the review CLI and the notification email. Absent on
  // submissions predating the guard.
  flags?: SubmitFlag[];
  // Lightning-address guard snapshot (2026-07-23 · see lib/ln-guard).
  // For nostr-platform submissions the submit route fetches the
  // signature-verified kind:0 at intake and records the verdict
  // here, so the reviewer sees "form vs signed profile" side by
  // side and the approve flow can gate on it. Absent on submissions
  // predating the guard (review tooling treats absent as
  // "unverified" · fail-visible, never fail-silent).
  // Multi-shop ownership evidence (2026-10 · lib/vendor-dedupe). Set
  // only when the handle already owns a live listing (flag
  // `existing-handle`): a backlink / nostr.json found at intake, or a
  // DM the reviewer recorded. Approval refuses without ok:true.
  ownershipCheck?: OwnershipCheck;
  profileCheck?: {
    // Unix seconds when the profile fetch ran.
    fetchedAt: number;
    // Did the verified kind:0 fetch succeed? Only meaningful for
    // nostr-platform submissions (false + status "no-anchor" for
    // the rest — no fetch was attempted).
    fetchOk: boolean;
    // Display name / picture from the SIGNED profile · lets the
    // reviewer eyeball "does this profile actually look like the
    // claimed brand" and pre-populates pictureUrl at approval.
    profileName?: string;
    profilePicture?: string;
    // The ln-guard verdict · requiresHold / needsConfirm drive the
    // review CLI's gates.
    lnGuard: LnGuardAssessment;
  };
};

const KEY_PREFIX = "submission:pending:";
const INDEX_KEY = "submission:pending:_index";
const INDEX_CAP = 500;
// Approved/rejected submissions are kept in KV with a TTL so the
// queue stays clean but recent decisions are inspectable.
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// H5 (audit 2026-05): per-id PENDING keys previously had NO TTL.
// The index LTRIMs to 500, but a submission flood accumulated
// unbounded `submission:pending:<id>` keys in Redis forever,
// exhausting the Upstash free-tier command/storage budget (which
// then cascades: /stack history, treasuries history, and all
// rate-limits share that instance and degrade/fail-open). A
// generous TTL bounds runaway accumulation WITHOUT failing-closed
// on legitimate submitters during a KV blip (the operator pushed
// back on aggressive rate-limit lockouts earlier). 60 days is far
// longer than any real review latency; the index cap (500) + this
// TTL together bound the blast radius.
const PENDING_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days

export function newSubmissionId(): string {
  // Audit 2026-05 L-4: the old `Math.random().toString(36)` tail was
  // ~30 bits of NON-cryptographic entropy — predictable, and
  // collision-prone in the same millisecond. The id is the KV key
  // suffix (`submission:pending:<id>`), so predictable ids let an
  // attacker guess/probe pending-submission keys. crypto.randomUUID()
  // is a Node built-in (zero dependency · the old "no uuid dep"
  // rationale predates it) giving 122 bits of CSPRNG entropy. The
  // base36 timestamp prefix is kept so the operator can still eyeball
  // the queue in rough submission order.
  return `${Date.now().toString(36)}-${randomUUID()}`;
}

export async function saveSubmission(s: VendorSubmission): Promise<boolean> {
  // H5 · bound runaway accumulation: pending keys now expire after
  // PENDING_TTL_SECONDS instead of living forever. Re-set with the
  // history TTL on finalize (approved/rejected) as before.
  const ok = await kvSet(KEY_PREFIX + s.id, s, PENDING_TTL_SECONDS);
  if (ok && s.status === "pending") {
    // Wrap in object · kvPushCapped stores plain strings as-is to
    // avoid double-stringifying, but kvList always JSON-parses on
    // read. Pushing an object means write/read round-trip cleanly.
    //
    // Audit 2026-05-14 finding H-5 (silent-failure-hunter): the prior
    // implementation discarded the kvPushCapped result. If the per-id
    // record landed (kvSet succeeded) but the index push failed, the
    // submission would be dark · operator's review CLI iterates the
    // index and never see it. The vendor would see "submission
    // received" while the entry sat unreachable. Now we log loudly
    // so the operator can manually reconstruct the index from
    // submission:pending:* keys if KV instability strikes mid-write.
    // We still return ok=true for the kvSet success · the data is
    // stored, just not indexed; that's a fixable state.
    const indexed = await kvPushCapped(INDEX_KEY, { id: s.id }, INDEX_CAP);
    if (!indexed) {
      console.error(
        `[saveSubmission] index-push failed · id=${s.id} · record stored but not in pending index, manual reconstruction may be needed`,
      );
    }
  }
  return ok;
}

export async function getSubmission(
  id: string,
): Promise<VendorSubmission | null> {
  return kvGet<VendorSubmission>(KEY_PREFIX + id);
}

export async function listPendingSubmissions(): Promise<VendorSubmission[]> {
  const wrapped = await kvList<{ id: string }>(INDEX_KEY, INDEX_CAP);
  if (wrapped.length === 0) return [];
  const ids = wrapped.map((w) => w.id).filter((x): x is string => !!x);
  // Fetch all in parallel · KV reads are cheap.
  const fetched = await Promise.all(
    ids.map((id) => kvGet<VendorSubmission>(KEY_PREFIX + id)),
  );
  return fetched.filter(
    (s): s is VendorSubmission => s !== null && s.status === "pending",
  );
}

/**
 * Mark a submission approved (or rejected). Removes it from the
 * pending index. Keeps the record in KV with a 30-day TTL so the
 * decision is auditable.
 */
export async function finalizeSubmission(
  id: string,
  decision:
    | {
        status: "approved";
        approvedAsAddedAt: number;
        /** Multi-shop: evidence recorded at approval (the DM fallback). */
        ownershipCheck?: OwnershipCheck;
      }
    | {
        status: "rejected";
        reason: string;
        outcome?: { code: OutcomeCode; note?: string };
      },
): Promise<boolean> {
  const existing = await getSubmission(id);
  if (!existing) return false;

  const updated: VendorSubmission = {
    ...existing,
    status: decision.status,
    ...(decision.status === "approved"
      ? {
          approvedAsAddedAt: decision.approvedAsAddedAt,
          ...(decision.ownershipCheck
            ? { ownershipCheck: decision.ownershipCheck }
            : {}),
        }
      : {
          rejectReason: decision.reason,
          ...(decision.outcome ? { outcome: decision.outcome } : {}),
        }),
  };
  // Write with TTL so the historical record auto-expires. The status
  // flip lives on the record itself (status: pending → approved/
  // rejected), which is the single source of truth.
  await kvSet(KEY_PREFIX + id, updated, HISTORY_TTL_SECONDS);

  // We intentionally do NOT touch the pending index here.
  //
  // Pentest 2026-06-01 finding M2 (was audit 2026-05-14 H-6): the old
  // approach deleted the index key and rebuilt it without the
  // finalized id · a delete-then-rebuild that is non-atomic. If kvDel
  // landed but a subsequent kvPushCapped failed (network blip, Upstash
  // rate limit, cron timeout), every id from the failure point onward
  // was silently dropped from the index. listPendingSubmissions
  // iterates the index, so those still-pending submissions went dark.
  //
  // Root-cause fix: the rebuild was never necessary. listPending­
  // Submissions re-fetches each record and filters by
  // `status === "pending"`, so an id left in the index that now points
  // to an approved/rejected (or TTL-expired → null) record is harmless
  // · it's filtered out at read time. The index is therefore an
  // append-only, LTRIM-bounded (INDEX_CAP=500) list of *recent*
  // submission ids, written only by saveSubmission. Stale finalized
  // ids cost one extra (cheap) kvGet on the operator-only review path
  // and age out of the 500-cap as new submissions arrive. No
  // mutation here means no non-atomic window and nothing to silently
  // lose. (Records remain individually addressable at
  // submission:pending:<id> regardless of index state.)
  return true;
}
