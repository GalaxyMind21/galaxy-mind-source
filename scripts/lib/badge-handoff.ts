// Operator handoff block for the vendor backlink badge.
//
// Why this exists (2026-07-29): /api/badge/vendor/[slug] describes
// itself as "the backlink engine", but the only place the embed snippet
// appeared was a card two thirds down /v/[slug] — a page most merchants
// never scroll — plus, since today, the "you're live" email.
//
// That email is NOT enough on its own. It only fires when a
// `vendor-notify:<handle>:<slug>` (or legacy per-handle) key exists in KV, i.e. only for merchants who
// self-submitted through /submit AND left an address. Every vendor the
// operator adds by hand via add-vendor.ts, and every approval where the
// submitter left no email, reaches the roster with nobody ever telling
// them the badge exists. Printing it at the end of both CLIs is the
// load-bearing half of the flywheel: the operator is already about to
// DM or reply to this merchant, and this is the paste.
//
// The daily drip (3 paste-ready DMs in the social-post-drafts email)
// covers the existing roster. This block covers the vendor in the
// operator's hand right now.
//
// Deliberately plain text with no ANSI colour — it is meant to be
// selected and pasted into a DM, and escape codes survive the copy.
import { badgeHandoffText, type BadgeOutreachVendor } from "../../src/lib/badge-outreach";

export function badgeHandoff(v: BadgeOutreachVendor | string): string {
  if (typeof v === "string") return badgeHandoffText({ name: v, handle: v });
  return badgeHandoffText(v);
}

/** Convenience for CLIs that just want it on stdout. */
export function printBadgeHandoff(v: BadgeOutreachVendor | string): void {
  console.log(badgeHandoff(v));
}
