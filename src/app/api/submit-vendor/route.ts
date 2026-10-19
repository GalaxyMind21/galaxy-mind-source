// POST /api/submit-vendor · public-facing form submission endpoint.
//
// Vendors fill out the /submit form, this writes the submission to
// the KV moderation queue. Operator reviews via
// `npx tsx scripts/review-submissions.ts` and approves/rejects.
//
// Validation contract (lib/submit-guard is the content gate):
//   - handle required, max 200 chars, platform-consistent
//     (X = username after @/URL normalize; email-shaped handles
//     are never X; consumer mail is never a valid identity)
//   - name required, max 100 chars
//   - description required, 30-300 chars, must mention bitcoin /
//     BTC / lightning / sats, and must not be bait / a plea
//   - acceptsBitcoinAtCheckout must be boolean true
//   - category required, must be a valid VendorCategory
//   - country required, ISO-3166 alpha-2
//   - website required, https:// URL that passes validateOutboundUrl
//   - notifyEmail required (one-shot outcome + badge-on-accept;
//     consumer mail OK; never published)
//   - Phase 1A enrichment fields optional (lightningAddress,
//     nostrPubkey, founderName, shipsInternational,
//     tradeFriendly, interestedIn)
//
// Anti-spam:
//   - Duplicate STOREFRONT check against current VENDORS + pending
//     queue (2026-10 · lib/vendor-dedupe): one handle may own several
//     shops, but a website is listed once, under one handle. A new
//     site under an existing handle is accepted, flagged
//     `existing-handle`, and gated on ownership proof at approval.
//   - KV-backed sliding-window rate limit (20 submissions/hour per IP ·
//     bumped from 5 on 2026-05-14 after legitimate-user complaints)
//   - Honeypot field rejected silently (never named in error text)
//   - Guard flags[] ride on the KV record so junk that slips through
//     is obvious in the review CLI / notification email
//
// CORS posture: the only first-party caller is /submit on the same
// origin, so we lock down to galaxymind.space (and the Vercel preview
// domain pattern via Origin echo when it's a *.vercel.app preview).
// Browsers don't enforce CORS on simple POSTs (the request still
// fires; CORS only blocks reading the response), but tightening the
// allow-origin still:
//   1. Stops third-party JS from getting a useful response back, so
//      any drive-by spam loses its feedback channel and stops being
//      a reliable abuse vector.
//   2. Removes "any origin can call this" from the documented
//      surface, narrowing the security review story.
// Server-side controls (honeypot + IP rate limit + KV moderation
// queue + manual operator approval) remain the actual CSRF mitigation.
//
// If a future widget needs to submit cross-origin, allow-list its
// origin explicitly here · do NOT revert to `*`.

import { NextRequest, NextResponse, after } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { VENDORS } from "@/lib/vendors";
import {
  conflictErrors,
  findListingConflicts,
  findPendingConflict,
} from "@/lib/vendor-dedupe";
import { checkOwnership } from "@/lib/ownership-proof";
import {
  listPendingSubmissions,
  newSubmissionId,
  saveSubmission,
  type VendorSubmission,
} from "@/lib/vendor-submissions";
import { isKvConfigured, kvIncrWithTtl } from "@/lib/kv";
import { sendTransactionalEmail } from "@/lib/email";
import { CATEGORY_LABELS, COUNTRIES } from "@/lib/vendors";
import { verifyTurnstileToken, isTurnstileConfigured } from "@/lib/turnstile";
import {
  assessSubmitGuard,
  sanitizeText,
  untrustedWebsiteReview,
  validateAndInferHandle,
} from "@/lib/submit-guard";
import { firstPartyCorsHeaders } from "@/lib/first-party-origin";
import {
  fetchNostrProfileMetadata,
  resolveNostrHandleToPubkey,
} from "@/lib/nostr-activity";
import { assessLnSubmission } from "@/lib/ln-guard";

export const runtime = "nodejs";

// Audit 2026-05-14 finding M-3 · https-only. Kept here for the
// signed-profile pictureUrl snapshot (kind:0 `picture` is untrusted
// relay content). The form-field website check lives in submit-guard.
const URL_RE = /^https:\/\/.+/;

const MAX_BODY_BYTES = 4_096; // generous for a small form

// Rate limit per IP per hour. Bumped 5 → 20 on 2026-05-14 after
// operator reports of legitimate users hitting the limit.
//
// Why 5 was too low: the rate limit fires on EVERY POST attempt (not
// just successful saves), and a normal vendor submission flow can
// burn 4-5 attempts in minutes:
//   · Initial submit · validation rejects (typo in handle field)
//   · Resubmit · validation rejects (description too short)
//   · Resubmit · validation rejects (duplicate handle they didn't
//     realize was already in the directory)
//   · Resubmit · success
// Add a colleague at the same NAT/VPN/corporate-egress submitting
// independently and the bucket is exhausted instantly.
//
// 20/hour preserves spam protection (a bot would still be visible
// in logs and IP-blockable) while giving real users headroom for
// retries. If a future spam wave overwhelms this, consider:
//   · Counting only successful (post-validation) saves toward the limit
//   · Adding Turnstile to the submit form
//   · Per-handle dedup before incrementing (already partial via
//     the duplicate-handle check, but it fires AFTER the increment)
const RATE_LIMIT_PER_HOUR = 20;

// First-party origins allowed to POST. Production apex + Vercel
// preview deployments (which use *.vercel.app) so the staging form
// works during PR review.
function corsHeaders(req: NextRequest): Record<string, string> {
  return firstPartyCorsHeaders(req, {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
}

// IP extraction moved to lib/client-ip.ts (audit 2026-05-14 · C-2/C-3
// fix · former implementation took split(",")[0] which Vercel does
// NOT strip from incoming X-Forwarded-For, allowing rate-limit bypass
// via spoofed XFF header).

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  // Body size cap · measure ACTUAL bytes, not the Content-Length
  // header (absent on chunked transfer, trivially spoofable). Mirrors
  // readCappedBody() in /api/subscribe so the documented 4KB cap is
  // actually enforced rather than advisory.
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid body" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "body too large" },
      { status: 413, headers: corsHeaders(req) },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "body must be JSON object" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  const b = body as Record<string, unknown>;

  // Honeypot · the form has a hidden field named "_hpot" that real
  // users never fill. If we receive it populated, silent-200 (don't
  // tell the bot it failed, just discard).
  if (typeof b._hpot === "string" && b._hpot.length > 0) {
    return NextResponse.json(
      { ok: true, accepted: true, queued: false },
      { headers: corsHeaders(req) },
    );
  }

  const ip = getClientIp(req);

  // ORDER: Turnstile BEFORE the KV rate limit — DELIBERATE, do not
  // "fix" it to match /api/subscribe (audit 2026-07-25).
  //
  // This was briefly swapped during the 2026-07-25 audit on the theory
  // that the limiter should gate the outbound siteverify call. That was
  // WRONG and the swap was reverted:
  //
  //   · kvIncrWithTtl is ONE METERED Upstash command per consult
  //     (lib/kv.ts). Turnstile's siteverify is a free, unmetered
  //     Cloudflare call (~100ms typical; the 3s in lib/turnstile.ts is
  //     only an abort ceiling).
  //   · So with captcha first, a flood of junk posts spends ZERO KV
  //     commands — each 400s at the captcha. With the limiter first,
  //     every unauthenticated request spends one metered command before
  //     its 429: at 100 req/s that is ~8.6M commands/day against the
  //     10K/day free tier the README tracks, exhausting it in ~100
  //     seconds and degrading every KV-backed surface site-wide
  //     (stack/treasury history, subscribe DOI, the moderation queue
  //     this route writes to) — and lib/rate-limit.ts fails OPEN.
  //   · The limiter's actual job (bounding QUEUE WRITES to 20/hour/IP)
  //     is unaffected by the order: nothing reaches saveSubmission
  //     without passing both gates.
  //
  // Gate the cheap free resource before the metered one. The stale
  // comment fragment that claimed otherwise is corrected below.

  // Optional Turnstile (when TURNSTILE_SECRET_KEY is configured).
  // This is the main spam defense for the public submission form.
  // Verified after the honeypot and BEFORE the metered KV limiter (see
  // the ORDER note above), and before any expensive validation, relay
  // fetch, or KV write.
  const turnstileToken =
    typeof b.turnstileToken === "string" ? b.turnstileToken : undefined;

  if (isTurnstileConfigured()) {
    const turnstileResult = await verifyTurnstileToken(turnstileToken, ip);
    if (!turnstileResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "captcha verification failed. Please try again.",
        },
        { status: 400, headers: corsHeaders(req) },
      );
    }
  }

  // Rate limit by IP · 20 submissions/hour (see RATE_LIMIT_PER_HOUR
  // constant for full reasoning). Uses kvIncrWithTtl. Falls back to
  // allow-all if KV is unconfigured (we'd rather take a few spam
  // submissions than wedge legitimate users out).
  if (isKvConfigured()) {
    const count = await kvIncrWithTtl(
      `submit-vendor:rl:${ip}`,
      3600,
    );
    // count can be null if KV write fails · fail-open in that case
    // (we'd rather take a spam submission than wedge out a legit user
    // on infrastructure flake). Audit 2026-05-14 H-3: log the fail-open
    // case so operator can correlate "rate limit not firing" to KV
    // instability events. Same pattern as /api/enrich-handle and
    // checkSubscribeRateLimit.
    if (count === null) {
      console.warn(
        `[submit-vendor:rl] kv unavailable · failing open · ip=${ip}`,
      );
    } else if (count > RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "rate limited · too many submission attempts from this network in the past hour. Try again later, or DM @GalaxyMind on X / Nostr for a manual add.",
        },
        { status: 429, headers: corsHeaders(req) },
      );
    }
  }

  // ── Field validation (lib/submit-guard · API is the source of truth)
  // Handle-shape still wins when unambiguous (the 2026-08 LN-guard
  // audit: an attacker who controls `platform` must not opt out of
  // the kind:0 fetch). Consumer mail + X-default + bait + no-bitcoin
  // die here so they never reach the operator inbox.
  const guard = assessSubmitGuard(b);
  const errors = [...guard.errors];
  const handle = guard.handle;
  const name = guard.name;
  const platform = guard.platform;

  // ── Duplicate detection (in-memory · free) ─────────────────────
  // Multi-shop (2026-10): the same handle may list another shop, so the
  // handle alone no longer rejects. A STOREFRONT already listed (under
  // any handle, which covers handle + same site) does, and so does a
  // name that lands on an existing /v slug (each shop needs its own).
  const submittedWebsite = guard.fields?.website;
  const candidate = {
    handle,
    platform: platform ?? undefined,
    name,
    website: submittedWebsite,
  };
  const conflicts = handle
    ? findListingConflicts(candidate, VENDORS)
    : { siteTaken: null, slugTaken: null, sameHandle: [] };
  if (handle) errors.push(...conflictErrors(candidate, conflicts));

  if (errors.length > 0) {
    return NextResponse.json(
      { ok: false, errors },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  // Pending-queue duplicate check AFTER the validation early-return.
  // listPendingSubmissions walks the 500-cap index one kvGet each
  // (security review F5, 2026-08-04). A well-formed handle plus a
  // description that was going to 400 used to pay that fan-out and
  // then reject — contradicting this route's own "junk spends zero
  // KV" ordering. In-memory VENDORS/slug checks above stay free.
  if (handle) {
    const pending = await listPendingSubmissions();
    const clash = findPendingConflict(candidate, pending);
    if (clash) {
      return NextResponse.json(
        {
          ok: false,
          errors: [
            clash === "site"
              ? "a submission for this website is already in the review queue"
              : "a submission with this shop name is already in the review queue · each shop needs its own name",
          ],
        },
        { status: 400, headers: corsHeaders(req) },
      );
    }
  }

  const f = guard.fields;
  if (!f) {
    return NextResponse.json(
      { ok: false, errors: ["validation failed"] },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  const {
    description,
    category,
    country,
    website,
    lightningAddress,
    nostrPubkey,
    founderName,
    shipsInternational,
    tradeFriendly,
    interestedIn,
    submitterNote,
    notifyEmail,
  } = f;

  // ── Lightning-address guard (2026-07-23 · lib/ln-guard) ────────
  // A form-submitted Lightning address is unauthenticated: anyone
  // can paste a legitimate vendor's PUBLIC npub and substitute their
  // own address to divert payments. For nostr submissions we fetch
  // the signature-verified kind:0 HERE, at intake, and snapshot the
  // verdict into the record — the reviewer sees "form vs signed
  // profile" side by side, and the approve flow gates on it.
  //
  // Runs inline (not in after()) deliberately: re-saving from
  // after() would double-push the pending index, and inline means
  // the operator's notification email can carry the verdict. Cost
  // is bounded by the lib's 5s relay timeout; submissions are rare
  // (20/hour/IP cap). A fetch failure is recorded as
  // fetchOk:false — fail-VISIBLE, the reviewer must see "could not
  // verify", never a silent pass.
  let profileCheck: VendorSubmission["profileCheck"];
  const handleShape = validateAndInferHandle(handle);
  const nostrShaped =
    handleShape.ok &&
    (handleShape.platform === "nostr" || handleShape.platform === "ambiguous");
  if (nostrShaped) {
    let profile: Awaited<ReturnType<typeof fetchNostrProfileMetadata>> = null;
    try {
      const pubkeyHex = await resolveNostrHandleToPubkey(handle);
      if (pubkeyHex) profile = await fetchNostrProfileMetadata(pubkeyHex);
    } catch {
      profile = null; // recorded as fetchOk:false below
    }
    const fetchOk = profile !== null;
    const rawName = profile?.display_name || profile?.name || "";
    const rawPicture = profile?.picture ?? "";
    profileCheck = {
      fetchedAt: Math.floor(Date.now() / 1000),
      fetchOk,
      // Same sanitize + https discipline as the form fields · this
      // content came from relays and lands in emails + the admin UI.
      ...(rawName ? { profileName: sanitizeText(rawName).slice(0, 100) } : {}),
      ...(rawPicture && URL_RE.test(rawPicture)
        ? { profilePicture: rawPicture.slice(0, 500) }
        : {}),
      lnGuard: assessLnSubmission({
        platform: "nostr",
        submittedLn: lightningAddress,
        profileFetchOk: fetchOk,
        profileLud16: profile?.lud16 ?? null,
      }),
    };
  } else if (lightningAddress) {
    // X / lightning platform with a payment address · no signed
    // source exists to verify against, but the reviewer still needs
    // the "confirm out-of-band" gate on the record.
    profileCheck = {
      fetchedAt: Math.floor(Date.now() / 1000),
      fetchOk: false,
      lnGuard: assessLnSubmission({
        platform: platform ?? "x",
        submittedLn: lightningAddress,
      }),
    };
  }

  // ── Multi-shop ownership evidence (2026-10) ────────────────────
  // Only when this identity already owns a live listing: the new site
  // must link back to the profile (or, for Nostr, name the pubkey in its
  // nostr.json). Runs after every validation gate and the pending check,
  // so junk never pays for the fetch; bounded by lib/ownership-proof's
  // timeouts. A miss is recorded, not rejected · the reviewer can still
  // confirm by DM, and approval refuses until one of the two holds.
  let ownershipCheck: VendorSubmission["ownershipCheck"];
  const existingHandle = conflicts.sameHandle.length > 0;
  if (existingHandle && website) {
    let pubkeyHex: string | null = null;
    if (nostrShaped) {
      try {
        pubkeyHex = await resolveNostrHandleToPubkey(handle);
      } catch {
        pubkeyHex = null;
      }
    }
    ownershipCheck = await checkOwnership({
      website,
      handle,
      platform: platform ?? "x",
      pubkeyHex,
    });
  }
  const flags = existingHandle
    ? [...guard.flags, "existing-handle" as const]
    : guard.flags;

  // ── Build submission record ────────────────────────────────────
  const submission: VendorSubmission = {
    id: newSubmissionId(),
    vendor: {
      handle,
      ...(platform && platform !== "x" ? { platform } : {}),
      name,
      description,
      category,
      ...(country ? { country } : {}),
      ...(lightningAddress ? { lightningAddress } : {}),
      ...(nostrPubkey ? { nostrPubkey } : {}),
      ...(website ? { website } : {}),
      ...(founderName ? { founderName } : {}),
      ...(shipsInternational ? { shipsInternational: true } : {}),
      ...(tradeFriendly ? { tradeFriendly: true } : {}),
      ...(interestedIn && interestedIn.length > 0 ? { interestedIn } : {}),
    },
    submittedAt: Math.floor(Date.now() / 1000),
    submitterNote,
    status: "pending",
    ...(flags.length > 0 ? { flags } : {}),
    ...(profileCheck ? { profileCheck } : {}),
    ...(ownershipCheck ? { ownershipCheck } : {}),
  };

  if (!isKvConfigured()) {
    // KV unavailable · we can't queue this. Tell the submitter and
    // fall back to "please DM us" guidance.
    return NextResponse.json(
      {
        ok: false,
        error:
          "submission queue temporarily unavailable. DM @GalaxyMind on X or Nostr with your details and we'll add you manually.",
      },
      { status: 503, headers: corsHeaders(req) },
    );
  }
  const saved = await saveSubmission(submission);
  // Persist the required notify-when-live email under a separate KV
  // key keyed by handle · the review CLI fires a one-shot
  // personalized "you're live" email at approval time via
  // /api/admin/notify-submitter (and emails a rejection when the
  // outcome code notifies); the new-vendor-digest cron remains the
  // fallback sender when the approval-time path didn't complete.
  // 90-day TTL so an approval that drags doesn't sit forever.
  if (saved && notifyEmail) {
    const { kvSet } = await import("@/lib/kv");
    const { vendorNotifyKey, NOTIFY_TTL_SECONDS } = await import(
      "@/lib/vendor-notify-key"
    );
    // Per LISTING (handle + slug), not per handle: a second shop under
    // the same handle must not overwrite the first one's address.
    await kvSet(vendorNotifyKey(handle, name), notifyEmail, NOTIFY_TTL_SECONDS);
  }
  if (!saved) {
    // M2 · log on save failure so the operator can correlate
    // visitor-reported "submission failed" reports to the actual
    // KV write that didn't land. Without this, lib/kv.ts logs an
    // anonymous [kv] HTTP error and there's no caller context.
    console.error(
      `[submit-vendor:save] failed · handle=${handle} · KV write did not return OK`,
    );
    return NextResponse.json(
      { ok: false, error: "couldn't save submission · please try again" },
      { status: 503, headers: corsHeaders(req) },
    );
  }

  // Fire-and-forget email notification · doesn't block the response.
  // No-op if SUBMISSION_NOTIFY_EMAIL isn't set in env. Failures are
  // surfaced to console (the submission is already in KV; email is
  // a notification convenience, not a durability layer).
  //
  // M5 · WRAPPED IN `after()`. The original `void notifyOnSubmission(...)`
  // pattern was the silent-drops root cause: Vercel's serverless runtime
  // terminates the function instance immediately after `return NextResponse.json`,
  // killing any in-flight fetch (the Resend POST) before it can complete
  // OR log its outcome. That matches the observed signature exactly:
  //
  //   · KV save completes (synchronous before response) → submission lands
  //   · Resend POST initiated but not yet resolved when response returns
  //   · Function instance terminated → fetch aborted, no log, no email
  //
  // Earlier "successful" sends in the logs were lucky timing where Vercel
  // happened to keep the instance warm long enough for fetch to complete.
  // The intermittency the operator saw ("3 of 7 submissions landed without
  // producing an email") wasn't Gmail spam-foldering · it was emails never
  // getting sent in the first place.
  //
  // `next/server` `after()` registers the work with Vercel's runtime as
  // post-response work, which the platform guarantees to run (up to the
  // route's maxDuration limit) before terminating. Resend POSTs typically
  // resolve in 200-500ms · well under any platform limit.
  //
  // Every path logs with the [submit-vendor:notify] prefix so the
  // operator can grep Vercel function logs to distinguish:
  //   · "skipped · env unset" → SUBMISSION_NOTIFY_EMAIL missing
  //   · "sent · <id>"         → Resend accepted the message
  //   · "failed:"             → Resend rejected (rate-limit, bounce, etc.)
  //   · "threw"               → unexpected exception in notify path
  after(async () => {
    try {
      const result = await notifyOnSubmission(submission);
      if (result.kind === "skipped") {
        console.log(
          `[submit-vendor:notify] skipped · SUBMISSION_NOTIFY_EMAIL unset · id=${submission.id}`,
        );
      } else if (result.kind === "sent") {
        console.log(
          `[submit-vendor:notify] sent · id=${submission.id} · resend=${result.id}`,
        );
      } else {
        // result.kind === "failed" · Resend rejected the message ·
        // the submission IS in KV but the operator's notification
        // never arrived. Loud log so a Resend rate-limit / bad-sender
        // / audience-block doesn't silently strand the queue.
        console.error(
          `[submit-vendor:notify] failed · id=${submission.id} · resend rejected: ${result.error}`,
        );
      }
    } catch (e) {
      // Catches a genuine throw from notifyOnSubmission · network
      // exception, etc. The Resend rejection path goes through the
      // result-kind branch above · this catches the unexpected.
      console.error(
        `[submit-vendor:notify] threw · id=${submission.id} ·`,
        e instanceof Error ? e.message : e,
      );
    }
  });

  return NextResponse.json(
    {
      ok: true,
      submissionId: submission.id,
      message:
        "Submission received. We review within 24-48 hours · you'll be added to the directory once verified.",
    },
    { headers: corsHeaders(req) },
  );
}

// ─────────────────────────────────────────────────────────────────
// Email notification · invoked from after() block after successful
// KV save · awaited inside the block so the post-response work
// completes before Vercel terminates the function instance
// ─────────────────────────────────────────────────────────────────

// Result type · distinguishes the three real outcomes so the caller
// can log them differently. M4 fix · the previous "sent | skipped"
// shape lied because Resend's rejection (rate-limit, bad sender,
// audience block) returned `sent` despite the email never landing.
// The whole point of the [submit-vendor:notify] instrumentation
// (per the comments above the call site) was to distinguish these
// failure modes; the missing "failed" case undermined it.
type NotifyResult =
  | { kind: "sent"; id: string }
  | { kind: "skipped" }
  | { kind: "failed"; error: string };

async function notifyOnSubmission(s: VendorSubmission): Promise<NotifyResult> {
  const to = process.env.SUBMISSION_NOTIFY_EMAIL;
  if (!to) return { kind: "skipped" }; // not configured · caller logs the skip

  const v = s.vendor;
  const flag = v.country ? COUNTRY_FLAG_FOR(v.country) : "";
  // Strip CRLF + control chars from the subject · defense in depth
  // against header injection (even though sanitizeText already
  // happened at submit time, future callers might bypass that path
  // and this layer guarantees safety at the email boundary).
  // eslint-disable-next-line no-control-regex
  const safeName = v.name.replace(/[\x00-\x1F\x7F]/g, "");
  // LN-guard verdict rides in the SUBJECT when it's a hard hold ·
  // the mismatch case is the fund-diversion attack and must be
  // unmissable in the inbox digest, not buried in a body row.
  const lnHold = s.profileCheck?.lnGuard.requiresHold === true;
  const flagged = (s.flags?.length ?? 0) > 0;
  const subject = `${lnHold ? "⚠ LN MISMATCH · " : ""}${flagged ? "⚠ FLAGS · " : ""}[Galaxy Mind] New vendor: ${safeName}${flag ? " " + flag : ""}`;
  const websiteReview = v.website ? untrustedWebsiteReview(v.website) : null;

  // Build a clean HTML body matching the brand · monospace block,
  // accent-orange highlights, plain-text-readable for email clients
  // that strip styles. Same design vibe as the rest of the
  // transactional emails on the site.
  const rows: Array<[string, string]> = [
    ["Handle", v.handle],
    ["Platform", v.platform ?? "x (default)"],
    ["Name", v.name],
    ["Category", CATEGORY_LABELS[v.category]],
    ...(v.country
      ? [
          [
            "Country",
            `${COUNTRIES[v.country]?.flag ?? ""} ${COUNTRIES[v.country]?.label ?? v.country} (${v.country})`,
          ] as [string, string],
        ]
      : []),
    ["Description", v.description],
    ...(v.lightningAddress
      ? [["Lightning", v.lightningAddress] as [string, string]]
      : []),
    ...(websiteReview
      ? [[websiteReview.label, websiteReview.emailValue] as [string, string]]
      : []),
    ...(s.flags && s.flags.length > 0
      ? [["Flags", s.flags.join(", ")] as [string, string]]
      : []),
    ...(v.founderName
      ? [["Founder", v.founderName] as [string, string]]
      : []),
    ...(v.shipsInternational
      ? [["Ships int'l", "yes"] as [string, string]]
      : []),
    ...(v.tradeFriendly
      ? [
          [
            "Trade-open",
            v.interestedIn && v.interestedIn.length > 0
              ? `yes · for ${v.interestedIn.join(", ")}`
              : "yes",
          ] as [string, string],
        ]
      : []),
    // LN guard verdict + the signed profile's own display name ·
    // "form vs signed profile" at a glance, before the review CLI
    // is even opened.
    ...(s.profileCheck
      ? [["LN guard", s.profileCheck.lnGuard.summary] as [string, string]]
      : []),
    // Multi-shop: the handle already runs a listed shop · the reviewer
    // must see the ownership evidence (or its absence) up front.
    ...(s.ownershipCheck
      ? [
          [
            "Ownership",
            `${s.ownershipCheck.ok ? "✓" : "⚠ needs DM"} · ${s.ownershipCheck.detail}`,
          ] as [string, string],
        ]
      : []),
    ...(s.profileCheck?.profileName
      ? [
          [
            "Profile name",
            `${s.profileCheck.profileName} (from signed kind:0)`,
          ] as [string, string],
        ]
      : []),
  ];

  const tableHtml = rows
    .map(
      ([k, val]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#A5A096;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:4px 0;color:#F2EFE9;font-family:-apple-system,sans-serif;font-size:14px;line-height:1.5;">${escapeHtml(val)}</td></tr>`,
    )
    .join("");

  const noteHtml = s.submitterNote
    ? `<div style="margin-top:20px;padding:12px;background:#1C1C21;border-left:3px solid #F7931A;font-family:-apple-system,sans-serif;font-size:13px;color:#A5A096;line-height:1.5;"><div style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#F7931A;margin-bottom:6px;">Private note from submitter</div>${escapeHtml(s.submitterNote)}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html><body style="background:#12110F;color:#F2EFE9;font-family:-apple-system,sans-serif;margin:0;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#1C1A16;border:1px solid #26262C;border-radius:12px;padding:24px;">
  <div style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.25em;color:#F7931A;margin-bottom:8px;">★ New submission · /submit</div>
  <h2 style="margin:0 0 4px;font-size:24px;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(v.name)}</h2>
  <div style="font-family:monospace;color:#F7931A;font-size:13px;margin-bottom:20px;">${escapeHtml(v.handle)}</div>

  <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
    ${tableHtml}
  </table>

  ${noteHtml}

  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #26262C;font-family:monospace;font-size:11px;color:#A5A096;line-height:1.6;">
    Submitted ${escapeHtml(new Date(s.submittedAt * 1000).toUTCString())}<br>
    Submission ID: <span style="color:#F2EFE9;">${escapeHtml(s.id)}</span>
  </div>

  <div style="margin-top:16px;padding:12px;background:#1C1C21;border-radius:6px;font-family:monospace;font-size:11px;color:#7ec0ff;line-height:1.6;">
    Review with:<br>
    <span style="color:#F2EFE9;">CRON_SECRET=&lt;your-secret&gt; npx tsx scripts/review-submissions.ts</span>
  </div>
</div>
<div style="text-align:center;margin-top:16px;font-family:monospace;font-size:10px;color:#666;">
  galaxymind.space · vendor onboarding queue
</div>
</body></html>`;

  // M4 · honor sendTransactionalEmail's result. Resend may reject
  // for legitimate reasons (rate limit, sender domain expired,
  // audience block, malformed payload) · returning "sent" without
  // checking was the silent failure the [submit-vendor:notify]
  // logging was supposed to prevent.
  const r = await sendTransactionalEmail({ to, subject, html });
  if (!r.ok) {
    return { kind: "failed", error: r.error };
  }
  return { kind: "sent", id: r.data.id };
}

function COUNTRY_FLAG_FOR(code: string): string {
  return COUNTRIES[code]?.flag ?? "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
