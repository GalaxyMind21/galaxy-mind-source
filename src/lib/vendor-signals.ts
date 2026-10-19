/**
 * vendor-signals · the pure half of continuous vendor monitoring.
 *
 * Everything here is a total function over hand-buildable values: no
 * network, no KV, no clock. That is deliberate — the queue policy is the
 * part that decides whether the operator gets woken up, so it has to be
 * exhaustively testable without mocking anything.
 *
 * The model is a CHANGE DETECTOR, never a judge. We never conclude "this
 * merchant stopped accepting bitcoin"; we conclude "this looks different
 * from yesterday, a human should look." That distinction is what keeps the
 * false-positive cost survivable, and it is why `verifiedAt` — which means
 * "the date a human last confirmed" — is never written from here.
 */

/** How many consecutive daily failures before a liveness drop queues. */
export const FAIL_STREAK_TO_QUEUE = 3;

/** Above this share of failed probes, blame ourselves and abort the run. */
export const ABORT_FAIL_RATIO = 0.3;

export type PaymentMarkers = {
  bitcoin: boolean;
  lightning: boolean;
  btc: boolean;
};

export type ProbeOutcome =
  /**
   * Fetched and read. `truncated` is true when the body was cut off by
   * `MAX_BODY_BYTES` before the response ended — two live shops already
   * exceed the 512KB cap. Absent/false for probes with no fetched body
   * (Nostr relay/NIP-05 checks) since there is nothing to truncate.
   */
  | { kind: "ok"; markers: PaymentMarkers; truncated?: boolean }
  /** Definitively absent: a 4xx/5xx we can believe. */
  | { kind: "gone"; status: number }
  /**
   * We could not form an opinion. 403/429/TLS/timeout/DNS. NOT evidence of
   * anything — Etsy storefronts and Cloudflare-fronted shops live here
   * permanently and must never be queued or counted against a vendor.
   */
  | { kind: "unprobeable"; reason: string };

export type VendorSignals = {
  handle: string;
  /**
   * Listing key (vendorKey · slug) since 2026-10. The shop probe is per
   * storefront and one handle may run several, so the KV hash field and
   * the baseline match use this. Optional only because baselines stored
   * before the move carry the handle alone (signalKey falls back).
   */
  key?: string;
  observedAt: number;
  /** null when the vendor carries no website field at all. */
  shop: ProbeOutcome | null;
  profile: ProbeOutcome | null;
  /**
   * Lightning address observed tonight. For Nostr-platform vendors this
   * is the signature-verified kind:0 `lud16` when that fetch succeeds
   * (trimmed; empty → null). Fetch failure, and every non-Nostr vendor,
   * keep the listed `lightningAddress` so a missed relay read cannot
   * look like drift-to-null. A value change across nights is
   * `lud16-drift` and queues at high priority — that is how a
   * compromised npub rotating the signed address surfaces. Never
   * written to vendors.ts from here.
   */
  lud16: string | null;
  failStreak: number;
};

/** Hash field / baseline identity for a signals record. */
export function signalKey(s: Pick<VendorSignals, "key" | "handle">): string {
  return s.key ?? s.handle;
}

export type SignalChange =
  | { type: "shop-gone" }
  | { type: "profile-gone" }
  | { type: "payment-markers-lost"; lost: string[] }
  | { type: "lud16-drift"; from: string; to: string };

export type QueueDecision = {
  queue: boolean;
  reason: string;
  priority: "high" | "normal";
};

/**
 * Word-boundary matching only. Substring matching produced false
 * positives on ordinary product copy ("lightningproof", "bitcoinsplaining"),
 * and a false positive here costs the operator a review of a healthy shop.
 */
export function extractPaymentMarkers(html: string): PaymentMarkers {
  const text = html.toLowerCase();
  return {
    bitcoin: /\bbitcoin\b/.test(text),
    lightning: /\blightning\b/.test(text),
    btc: /\bbtc\b/.test(text),
  };
}

function markerNames(m: PaymentMarkers): string[] {
  return (["bitcoin", "lightning", "btc"] as const).filter((k) => m[k]);
}

/**
 * Compare two observations. Only OK→gone and OK→OK transitions can produce
 * a change: anything involving `unprobeable` is silence, not signal.
 */
export function diffSignals(
  prev: VendorSignals | null,
  next: VendorSignals,
): SignalChange[] {
  if (!prev) return [];
  const out: SignalChange[] = [];

  for (const [field, type] of [
    ["shop", "shop-gone"],
    ["profile", "profile-gone"],
  ] as const) {
    const a = prev[field];
    const b = next[field];
    if (a?.kind === "ok" && b?.kind === "gone") out.push({ type });
  }

  // Payment markers: only a TOTAL loss counts. Losing one of three is
  // ordinary copy churn (a seasonal banner, a reworded checkout) and
  // queueing on it would make the queue worthless within a week.
  //
  // Skip the comparison entirely when EITHER read was truncated by the
  // body cap. A marker present past byte 512,000 reads as absent on the
  // truncated side, so a page merely crossing the cap between two nights
  // (two live shops already exceed it) would look identical to the shop
  // actually dropping every marker — a false high-priority alert with no
  // merchant-side change at all.
  if (
    prev.shop?.kind === "ok" &&
    next.shop?.kind === "ok" &&
    !prev.shop.truncated &&
    !next.shop.truncated
  ) {
    const before = markerNames(prev.shop.markers);
    const after = markerNames(next.shop.markers);
    if (before.length > 0 && after.length === 0) {
      out.push({ type: "payment-markers-lost", lost: before });
    }
  }

  if (prev.lud16 && next.lud16 && prev.lud16 !== next.lud16) {
    out.push({ type: "lud16-drift", from: prev.lud16, to: next.lud16 });
  }

  return out;
}

/**
 * Encodes liveness as a streak. A `gone` on either probe advances the
 * streak; both-ok resets it; `unprobeable` preserves it (it is not evidence
 * of anything). Preserving on unprobeable is crucial: a vendor alternating
 * gone/unprobeable/gone must not have the streak laundered by the bot-blocked
 * days, or the 3-strikes rule becomes unenforceable.
 */
export function nextFailStreak(
  prev: VendorSignals | null,
  next: VendorSignals,
): number {
  // Collect only the probes that exist (not null). A probe that does not
  // exist cannot be unhealthy. Requiring shop to literally read "ok" meant
  // the 28 vendors with no website could never reset, and ratcheted into the
  // review queue permanently.
  const probes = [next.shop, next.profile].filter((p) => p != null);

  // If any existing probe is gone, increment
  const anyGone = probes.some((p) => p.kind === "gone");
  if (anyGone) {
    return (prev?.failStreak ?? 0) + 1;
  }

  // If all existing probes are ok, reset. If no probes exist at all (both null),
  // reset too — there is no evidence of failure.
  const allPresentOk = probes.length > 0 && probes.every((p) => p.kind === "ok");
  const noProbesAtAll = probes.length === 0;
  if (allPresentOk || noProbesAtAll) {
    return 0;
  }

  // Otherwise (some probes are unprobeable, none gone), preserve the streak
  return prev?.failStreak ?? 0;
}

export function shouldQueue(
  changes: SignalChange[],
  failStreak: number,
): QueueDecision {
  const drift = changes.find((c) => c.type === "lud16-drift");
  if (drift) {
    return {
      queue: true,
      // Fires on a live kind:0 change (the fund-diversion case) AND on
      // a listed-value edit between runs. Same high-priority queue
      // either way — a human has to decide which address is real.
      reason: "Lightning address changed (signed kind:0 or listed)",
      priority: "high",
    };
  }

  const lost = changes.find((c) => c.type === "payment-markers-lost");
  if (lost) {
    return {
      queue: true,
      reason: "shop page no longer mentions bitcoin, lightning or BTC",
      priority: "high",
    };
  }

  // The streak is the liveness signal, NOT `changes`. diffSignals only
  // emits shop-gone/profile-gone on the ok -> gone TRANSITION, so by the
  // time a streak reaches the threshold the vendor has been gone for days
  // and `changes` is empty. Reading liveness from `changes` here made this
  // branch unreachable and silently disabled the whole 3-strikes rule.
  if (failStreak >= FAIL_STREAK_TO_QUEUE) {
    return {
      queue: true,
      reason: `unreachable ${failStreak} days running`,
      priority: "normal",
    };
  }

  return { queue: false, reason: "", priority: "normal" };
}
