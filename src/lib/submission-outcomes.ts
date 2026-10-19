// Submission outcome codes · the single source of truth for what a
// submitter is told when their entry is approved or declined.
//
// WHY THIS EXISTS (2026-08-20). The queue stored one free-text
// `rejectReason`, and that field was doing two incompatible jobs at
// once: it was the INTERNAL audit note a future session reads when the
// same handle resubmits, and it was the only thing available to send to
// the submitter. Those cannot be the same string. A real stored reason
// reads:
//
//   "...every scam probe came back clean: domain registered 5 months
//    ago, nostr identity 130 days old ... expect further submissions
//    from this submitter on behalf of paying clients."
//
// That is exactly right as an audit note and completely wrong as an
// email. Worse, it is 2,177 characters against the 1,000-char cap
// /api/admin/notify-submitter enforces — so the three most carefully
// reasoned rejections on file were the three that could never have been
// delivered even if the operator had opted in.
//
// So: `rejectReason` stays the private audit note, unchanged. The
// submitter-facing half lives here, as a closed set of eleven codes with
// pre-written copy. The operator picks a code instead of writing prose,
// which is what makes "and here is what to fix" automatic rather than
// something remembered.
//
// SILENT CODES. Four outcomes deliberately send nothing (operator
// decision, 2026-08-20). The load-bearing one is `already-listed`:
// scripts/add-vendor.ts does not finalize the KV record, so the queue
// fills with phantom "pending" rows for vendors that are already live
// (11 of 16 on one audited day). Notifying those would email a listed
// merchant to tell them they were rejected.
//
// Invariants are enforced by scripts/test-submission-outcomes.ts.

/** Text cap enforced by /api/admin/notify-submitter. */
export const OUTCOME_TEXT_CAP = 1000;

export type OutcomeCode =
  // ── notifying ────────────────────────────────────────────────────
  | "no-payment-confirmed"
  | "no-social-identity"
  | "ln-mismatch"
  | "placement-conflict"
  | "not-a-vendor"
  | "unreachable"
  | "controlled-substance"
  // ── silent ───────────────────────────────────────────────────────
  | "spam"
  | "already-listed"
  | "bulk-clear"
  | "superseded";

export type SubmissionOutcome = {
  code: OutcomeCode;
  /** Operator-facing menu label in the review CLI / admin UI. */
  label: string;
  /** Does the submitter hear about this one? */
  notifies: boolean;
  /** Submitter-facing: why. Empty string on silent codes. */
  message: string;
  /**
   * Submitter-facing: what to fix.
   *
   * `null` means there is no path back right now, and that is a
   * deliberate option rather than an oversight — inventing a remedy for
   * a decision that is actually closed is worse than saying nothing,
   * because it invites a resubmission that will be declined again.
   */
  remedy: string | null;
};

export const OUTCOMES: Record<OutcomeCode, SubmissionOutcome> = {
  "no-payment-confirmed": {
    code: "no-payment-confirmed",
    label: "Bitcoin payment not confirmed",
    notifies: true,
    message:
      "We could not confirm a bitcoin payment for a genuine good or service. A listing goes up only after a person here has confirmed one, which is the whole basis of the directory.",
    remedy:
      "Publish a bitcoin checkout or a Lightning address on your site so the payment path is visible, then resubmit.",
  },
  "no-social-identity": {
    code: "no-social-identity",
    label: "No X or Nostr identity",
    notifies: true,
    message:
      "New listings need an X or Nostr profile as the trust anchor. A Lightning address on its own proves that a wallet resolves, not that an accountable merchant stands behind it.",
    remedy:
      "Resubmit with your X handle or Nostr npub and we will take another look.",
  },
  "ln-mismatch": {
    code: "ln-mismatch",
    label: "Lightning address does not match signed profile",
    notifies: true,
    message:
      "The Lightning address on the submission does not match the one in your signed Nostr profile. We hold these rather than guess, because an npub is public and payment details are the thing worth stealing.",
    remedy:
      "Confirm the correct address from the account pinned to your profile, then resubmit.",
  },
  "placement-conflict": {
    code: "placement-conflict",
    label: "Sells directory placement to clients",
    notifies: true,
    message:
      "Your business sells listing and upkeep in bitcoin directories to its own clients. Galaxy Mind is free and hand curated, so listing you would turn a free listing here into a paid deliverable of your product.",
    remedy:
      "If the directory placement lines come out of your packages, and someone here can confirm an actual bitcoin payment for your own work, resubmit and we will look again.",
  },
  "not-a-vendor": {
    code: "not-a-vendor",
    label: "Nothing sold for bitcoin",
    notifies: true,
    message:
      "We could not find a good or service on offer for bitcoin. The directory lists places you can actually spend at, so a project or a profile on its own is not enough.",
    remedy:
      "Point us at the thing you sell and how someone pays for it in bitcoin, then resubmit.",
  },
  unreachable: {
    code: "unreachable",
    label: "Handle or site did not respond",
    notifies: true,
    message:
      "The handle or site on the submission did not respond when we checked, so there was nothing for a human to verify.",
    remedy: "Check the handle and the link, then resubmit.",
  },
  "controlled-substance": {
    code: "controlled-substance",
    label: "Cannabis / controlled-substance shop",
    notifies: true,
    message:
      "Galaxy Mind does not list cannabis or other controlled-substance shops. That is a bitcoin.org spend-page term: listed vendors must not promote illicit activity.",
    remedy: null,
  },

  // ── silent ───────────────────────────────────────────────────────
  spam: {
    code: "spam",
    label: "Spam / honeypot",
    notifies: false,
    message: "",
    remedy: null,
  },
  "already-listed": {
    code: "already-listed",
    label: "Phantom record · vendor already live",
    notifies: false,
    message: "",
    remedy: null,
  },
  "bulk-clear": {
    code: "bulk-clear",
    label: "Bulk queue clear",
    notifies: false,
    message: "",
    remedy: null,
  },
  superseded: {
    code: "superseded",
    label: "Superseded by a later submission",
    notifies: false,
    message: "",
    remedy: null,
  },
};

export const OUTCOME_CODES = Object.keys(OUTCOMES) as OutcomeCode[];

export const NOTIFYING_CODES = OUTCOME_CODES.filter(
  (c) => OUTCOMES[c].notifies,
);

export function isOutcomeCode(v: unknown): v is OutcomeCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(OUTCOMES, v);
}

export function outcomeFor(code: string): SubmissionOutcome | null {
  return isOutcomeCode(code) ? OUTCOMES[code] : null;
}

/**
 * Compose the submitter-facing body for a code, plus the operator's
 * optional extra sentence.
 *
 * The note is appended to the MESSAGE, never to the remedy: the remedy
 * is the actionable line and stays the template's words so it cannot be
 * blurred into a paragraph the reader skims past.
 */
export function renderOutcomeBody(
  code: OutcomeCode,
  note?: string,
): { message: string; remedy: string | null } {
  const o = OUTCOMES[code];
  const extra = (note ?? "").trim();
  return {
    message: extra ? `${o.message}\n\n${extra}` : o.message,
    remedy: o.remedy,
  };
}

/** Total characters the notify endpoint will see for this outcome. */
export function outcomeBodyLength(code: OutcomeCode, note?: string): number {
  const { message, remedy } = renderOutcomeBody(code, note);
  return message.length + (remedy ? remedy.length : 0);
}

/** How much room an operator note still has before the cap. */
export function noteHeadroom(code: OutcomeCode): number {
  return OUTCOME_TEXT_CAP - outcomeBodyLength(code);
}

/**
 * Paste-ready DM text for when no notify address is on file.
 *
 * Deliberately plain text with no links or markup: it is going to be
 * pasted into an X or Nostr DM box by a human. There is no DM sender in
 * this repo and adding one would mean an nsec in Vercel env (which
 * lib/nostr.ts refuses in writing) or an X token scope we do not hold,
 * so the handoff IS the mechanism — same pattern as printBadgeHandoff
 * and the social-drafts cron, which draft for the operator and post
 * nothing themselves.
 */
export function dmHandoffText(
  vendorName: string,
  code: OutcomeCode,
  note?: string,
): string {
  const { message, remedy } = renderOutcomeBody(code, note);
  const lines = [
    `Thanks for submitting ${vendorName} to Galaxy Mind.`,
    "",
    message,
  ];
  if (remedy) lines.push("", `What to fix: ${remedy}`);
  lines.push("", "https://galaxymind.space/submit");
  return lines.join("\n");
}

/** Profile URL for a handle, for the DM handoff.
 *  Handle SHAPE outranks the claimed platform — an npub submitted with
 *  platform omitted used to mint https://x.com/npub1… which is unusable. */
export function profileUrlFor(handle: string, platform?: string): string {
  // Strip a leading @ first so "@GalaxyMind" is an X handle, not a
  // name@domain. A mid-string @ (alice@example.com) is untouched.
  const h = handle.trim().replace(/^@/, "");
  if (/^(npub|nprofile)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/i.test(h)) {
    return `https://njump.me/${h}`;
  }
  if (platform === "nostr") return `https://njump.me/${h}`;
  if (platform === "lightning") return "";
  if (h.includes("@")) {
    // name@domain without an explicit platform: NIP-05 vs Lightning
    // Address cannot be told apart. Don't invent x.com/foo@bar.
    return platform === "x" ? `https://x.com/${h}` : "";
  }
  return `https://x.com/${h}`;
}
