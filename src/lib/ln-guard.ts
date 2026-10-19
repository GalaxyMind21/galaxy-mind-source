// ln-guard · Lightning-address reconciliation for vendor submissions.
//
// Threat model (2026-07-23, prompted by the Sat's Oil submission):
// an npub is a PUBLIC identifier — pasting one into /submit proves
// nothing about who's pasting. An attacker can submit a legitimate
// vendor's npub with their OWN Lightning address in the form field
// and, if published, silently divert every payment. The one
// payment-address source an attacker cannot forge is the `lud16`
// inside the vendor's kind:0 profile event, because changing it
// requires the vendor's PRIVATE key (and lib/nostr-activity
// signature-verifies every event before trust).
//
// Policy encoded here (tested by scripts/test-ln-guard.ts):
//   · verified profile CONTRADICTS the form → requiresHold: the
//     reviewer must explicitly choose profile / form / omit, after
//     confirming with the key holder. Neither value auto-publishes.
//   · a payment address exists but has NO crypto anchor (X vendors,
//     fetch failure, profile without lud16) → needsConfirm: soft
//     gate, reviewer must attest out-of-band confirmation.
//   · nothing submitted → no gate; the signed lud16 (when present)
//     is offered as a suggestion, never auto-adopted — a kind:0
//     lud16 is where ZAPS land, which is not necessarily the
//     business till (the Sat's Oil lesson: the vendor deliberately
//     overrode the enriched lud16 with a different address).
//
// Deliberately pure + dependency-free: no fetches, no Date, no
// randomness. Callers do the (signature-verified) profile fetch and
// hand results in; this module only judges.

import type { VendorPlatform } from "@/lib/vendors";

export type LnGuardStatus =
  // Form value equals the signature-verified kind:0 lud16.
  | "match"
  // Form value CONTRADICTS the signed lud16 · hard hold.
  | "mismatch"
  // Profile fetched + verified, but carries no lud16 · the form
  // value is unanchored.
  | "profile-missing-ln"
  // Relay fetch failed / timed out · verification never happened.
  // Fail-VISIBLE: this must never silently degrade into "fine".
  | "unverified"
  // Platform has no signed payment source (X / lightning / default).
  | "no-anchor"
  // Nothing to guard.
  | "no-ln-submitted";

export type LnGuardInput = {
  platform: VendorPlatform | undefined;
  submittedLn?: string;
  // Only meaningful for nostr-platform submissions.
  profileFetchOk?: boolean;
  // The lud16 from the signature-verified kind:0, when fetched.
  // Empty string is treated as absent (profiles commonly carry
  // `"lud16": ""`).
  profileLud16?: string | null;
};

export type LnGuardAssessment = {
  status: LnGuardStatus;
  // Hard gate: approve flow must force an explicit resolution
  // (publish profile value / form value / omit) — never a default.
  requiresHold: boolean;
  // Soft gate: approve flow must ask the reviewer to attest that
  // the address was confirmed out-of-band with the vendor.
  needsConfirm: boolean;
  // Normalized copies for reviewer display / email surfacing.
  submittedLn?: string;
  profileLud16?: string;
  // When nothing was submitted but the signed profile has a lud16,
  // surface it as an adoptable suggestion.
  suggestedLn?: string;
  // One-line human-readable verdict for the notification email and
  // the review CLI.
  summary: string;
};

// Same shape the submit route validates (name@domain.tld). Local
// part is compared verbatim after lowercasing — LUD-16 usernames
// are lowercase by spec, but we must NEVER fuzzy-match beyond case:
// `sats_oil_` and `sats_oil` are different custodial accounts.
const LN_SHAPE_RE = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * Trim + lowercase, then shape-check. Returns null when the input
 * isn't a plausible Lightning address (so garbage can never
 * "match" garbage).
 */
export function normalizeLnAddress(raw: string): string | null {
  const norm = raw.trim().toLowerCase();
  return LN_SHAPE_RE.test(norm) ? norm : null;
}

/** Normalized equality · false when either side fails to normalize. */
export function lnAddressesMatch(a: string, b: string): boolean {
  const na = normalizeLnAddress(a);
  const nb = normalizeLnAddress(b);
  return na !== null && nb !== null && na === nb;
}

/** Judge one submission's Lightning address against its anchor. */
export function assessLnSubmission(input: LnGuardInput): LnGuardAssessment {
  const submitted = input.submittedLn
    ? normalizeLnAddress(input.submittedLn) ?? input.submittedLn.trim()
    : undefined;
  const profileLud16Raw = (input.profileLud16 ?? "").trim();
  const profileLud16 = profileLud16Raw
    ? normalizeLnAddress(profileLud16Raw) ?? profileLud16Raw.toLowerCase()
    : undefined;

  // Nothing submitted → nothing to divert. Suggest the signed lud16
  // when we have one (nostr + successful fetch only).
  if (!submitted) {
    const suggestedLn =
      input.platform === "nostr" && input.profileFetchOk && profileLud16
        ? profileLud16
        : undefined;
    return {
      status: "no-ln-submitted",
      requiresHold: false,
      needsConfirm: false,
      ...(suggestedLn ? { suggestedLn } : {}),
      summary: suggestedLn
        ? `no Lightning address submitted · signed profile offers ${suggestedLn}`
        : "no Lightning address submitted",
    };
  }

  // Only nostr submissions have a signed payment source to compare
  // against. Everything else is an unanchored payment address →
  // out-of-band confirmation before publish.
  if (input.platform !== "nostr") {
    return {
      status: "no-anchor",
      requiresHold: false,
      needsConfirm: true,
      submittedLn: submitted,
      summary: `Lightning address ${submitted} has no signed source to verify against · confirm with the vendor out-of-band before publishing`,
    };
  }

  if (!input.profileFetchOk) {
    return {
      status: "unverified",
      requiresHold: false,
      needsConfirm: true,
      submittedLn: submitted,
      summary: `could NOT verify ${submitted} · profile fetch failed, verification never ran · confirm out-of-band before publishing`,
    };
  }

  if (!profileLud16) {
    return {
      status: "profile-missing-ln",
      requiresHold: false,
      needsConfirm: true,
      submittedLn: submitted,
      summary: `signed profile carries no lud16 · submitted ${submitted} is unanchored · confirm out-of-band before publishing`,
    };
  }

  if (submitted === profileLud16) {
    return {
      status: "match",
      requiresHold: false,
      needsConfirm: false,
      submittedLn: submitted,
      profileLud16,
      summary: `submitted Lightning address matches the signed profile lud16 (${profileLud16})`,
    };
  }

  return {
    status: "mismatch",
    requiresHold: true,
    needsConfirm: true,
    submittedLn: submitted,
    profileLud16,
    summary: `⚠ MISMATCH · form says ${submitted} but the signed profile lud16 is ${profileLud16} · HOLD: confirm with the key holder which address to publish`,
  };
}
