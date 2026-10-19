// Helpers for the /api/subscribe + /api/subscribe/confirm flow.
//
// Three concerns, factored out of the route handlers so they can be
// tested independently and reused across the request and confirm
// endpoints:
//
//   1. Rate limit: KV-backed sliding window per IP (5/hour). When KV
//      unset → no rate limit; the route proceeds.
//
//   2. Pending-subscribe storage: when KV is configured, /api/subscribe
//      doesn't immediately add to Resend. Instead it stashes the email
//      under a random token (TTL 24h), emails the visitor a magic link
//      back to /api/subscribe/confirm?token=…, and only on click does
//      the route push to Resend. This is the standard double-opt-in
//      pattern — without it, a malicious actor can subscribe other
//      people's emails, which is both a deliverability risk for our
//      sender domain and an annoyance to the victim.
//
//   3. When KV is NOT configured, the flow degrades to immediate add
//      (the original behavior). This means `/api/subscribe` returns
//      `{ok:true,kind:"added"}` instead of `{ok:true,kind:"pending"}`.
//      The form's success copy varies on the response shape.

import {
  kvGet,
  kvGetChecked,
  kvSet,
  kvDel,
  kvIncrWithTtl,
  isKvConfigured,
} from "./kv";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import type { FitAlertRecord } from "./fit-alert";

// Rate-limit window: 5 requests per IP per hour.
const RATE_LIMIT_WINDOW_S = 3600;
const RATE_LIMIT_MAX = 5;

// Pending-subscribe TTL: tokens expire 24h after issue. After that
// the visitor must request a new confirmation email.
const PENDING_TTL_S = 24 * 3600;

export type RateLimitResult =
  | { ok: true; remaining?: number }
  | { ok: false; reason: "rate-limited"; retryAfterSeconds: number };

/**
 * Sliding-window rate limit per IP. Returns ok:true if the request
 * may proceed, ok:false (with retry-after) if not.
 *
 * If KV is unconfigured, returns ok:true unconditionally — better to
 * degrade open than to block all subscriptions when KV is down.
 * (Rate limiting is a defense-in-depth, not the primary control.)
 */
export async function checkSubscribeRateLimit(
  clientIp: string,
): Promise<RateLimitResult> {
  if (!isKvConfigured()) return { ok: true };
  const key = `subscribe:rl:${clientIp}`;
  const count = await kvIncrWithTtl(key, RATE_LIMIT_WINDOW_S);
  if (count == null) {
    // Audit 2026-05-14 finding H-3 (silent-failure-hunter): the prior
    // implementation returned ok:true silently when KV was unavailable.
    // Match the loud-log pattern from /api/enrich-handle so an operator
    // running `vercel logs --follow` can correlate "subscribe rate
    // limit ineffective" to a KV outage event. Still fails open by
    // intent · degrading subscribe is worse than degrading rate limiting.
    console.warn(
      `[subscribe-flow:rl] kv unavailable · failing open · ip=${clientIp}`,
    );
    return { ok: true };
  }
  if (count > RATE_LIMIT_MAX) {
    return {
      ok: false,
      reason: "rate-limited",
      retryAfterSeconds: RATE_LIMIT_WINDOW_S,
    };
  }
  return { ok: true, remaining: RATE_LIMIT_MAX - count };
}

/**
 * Source channel a subscriber opted in FROM. Drives the
 * confirmation email's subject/body and the post-confirm CTA so the
 * user is sent BACK to the surface they came from (not always
 * /stack, which was the legacy hardcoded behavior).
 *
 * Adding a new value here is the only step needed to support a new
 * channel · the confirm route + renderConfirmEmail both key off
 * this discriminator. Unknown values fall through to "stack" (the
 * historical default).
 */
export type SubscribeSource =
  | "stack"        // gauge tier-flip + extreme alerts (default)
  | "fit"          // /fit allocation-change alerts
  | "treasuries"   // mNAV cheap/rich alerts
  | "float"        // float milestone alerts
  | "vendors"      // new-merchant weekly digest
  | "today"        // daily briefing habit page
  | "seo"          // SEO doorway capture strips
  | "hashrate";    // /hashrate sold-out waitlist + availability pings

const VALID_SOURCES: ReadonlySet<string> = new Set([
  "stack",
  "fit",
  "treasuries",
  "float",
  "vendors",
  "today",
  "seo",
  "hashrate",
]);

/** Validate an untrusted source value · returns it if known, else "stack". */
export function normalizeSubscribeSource(s: unknown): SubscribeSource {
  if (typeof s === "string" && VALID_SOURCES.has(s)) {
    return s as SubscribeSource;
  }
  return "stack";
}

/**
 * Mint a single-use opt-in token for an email + their requested
 * preferences. Stores the email AND prefs under the token key with a
 * 24h TTL. The prefs travel with the token (rather than being saved
 * separately at signup time) so an unconfirmed signup leaves no
 * orphan prefs record.
 *
 * The optional `fitAlert` blob is the /fit allocation-change opt-in's
 * baseline snapshot · the same email-ownership-proof gate guards it,
 * so a hostile actor who knows a victim's email can't create a
 * fit-alert KV record on their behalf either.
 *
 * The optional `source` records which surface the subscriber came
 * from so the confirmation email + success page can route them back.
 *
 * Token is 32 bytes of crypto-random hex (256 bits).
 */
export async function createPendingSubscribe(
  email: string,
  // Partial · a channel opt-in sends ONLY the keys it wants, so the confirm
  // merge doesn't clobber a returning subscriber's other opt-ins with
  // default-false (2026-07-10 bug audit · H2).
  prefs?: Partial<SubscriberPrefs>,
  fitAlert?: FitAlertRecord,
  source?: SubscribeSource,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!isKvConfigured()) {
    return { ok: false, error: "KV unavailable for double-opt-in" };
  }
  const token = randomBytes(32).toString("hex");
  const stored = await kvSet(
    `subscribe:pending:${token}`,
    {
      email,
      prefs: prefs ?? null,
      fitAlert: fitAlert ?? null,
      source: source ?? "stack",
      createdAt: Date.now(),
    },
    PENDING_TTL_S,
  );
  if (!stored) {
    return { ok: false, error: "failed to stash pending token" };
  }
  return { ok: true, token };
}

/**
 * Look up + consume a pending opt-in token. Returns the email +
 * prefs (if any were submitted at signup) on success.
 */
export type ConsumeResult =
  | {
      kind: "ok";
      email: string;
      // Partial · only the keys the client sent at signup (H2).
      prefs: Partial<SubscriberPrefs> | null;
      fitAlert: FitAlertRecord | null;
      source: SubscribeSource;
    }
  | { kind: "not-found" }       // token never existed, or was already consumed
  | { kind: "kv-unconfigured" } // KV not set up; DOI flow inactive
  | { kind: "malformed" };      // token didn't match the format

/**
 * Read a pending opt-in token WITHOUT consuming it · the DOI confirm
 * route uses peek + delete-on-success so a Resend hiccup mid-confirm
 * doesn't burn a still-valid token (the user can just re-click the
 * link).
 */
export async function peekPendingSubscribe(
  token: string,
): Promise<ConsumeResult> {
  if (!isKvConfigured()) return { kind: "kv-unconfigured" };
  // Token format check before hitting KV — saves a round-trip on
  // obviously malformed input. Log the prefix so operators can see
  // if email-client URL mangling becomes a pattern.
  if (!/^[a-f0-9]{64}$/.test(token)) {
    console.warn(
      "[subscribe-flow] malformed token attempt:",
      token.slice(0, 8) + "...",
    );
    return { kind: "malformed" };
  }
  const key = `subscribe:pending:${token}`;
  const entry = await kvGet<{
    email: string;
    prefs: Partial<SubscriberPrefs> | null;
    fitAlert?: FitAlertRecord | null;
    source?: SubscribeSource;
    createdAt: number;
  }>(key);
  if (!entry) return { kind: "not-found" };
  return {
    kind: "ok",
    email: entry.email,
    prefs: entry.prefs ?? null,
    fitAlert: entry.fitAlert ?? null,
    source: normalizeSubscribeSource(entry.source),
  };
}

/**
 * Explicit delete · paired with peekPendingSubscribe in the DOI
 * confirm flow. Idempotent: deleting a missing or malformed token
 * is a no-op (kvDel handles absent keys).
 */
export async function deletePendingSubscribeToken(token: string): Promise<void> {
  if (!isKvConfigured()) return;
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  await kvDel(`subscribe:pending:${token}`);
}

/* =====================================================================
 * Unsubscribe via stateless HMAC tokens.
 *
 * We use HMAC-SHA256(email, UNSUB_SECRET) instead of KV-stored tokens
 * because:
 *   1. Stateless — no KV growth as the audience grows.
 *   2. No expiry needed — unsubscribe is itself the revoke action;
 *      a 6-month-old email link should still work to remove the user.
 *   3. Idempotent — clicking twice is harmless (already-unsubbed Resend
 *      contacts return 200/no-op).
 *   4. The token IS the proof — knowing your own email + the public
 *      site secret never grants attack capability beyond unsubbing
 *      yourself; an attacker who knows a victim's email can already
 *      unsubscribe them by impersonation, this just gives the legit
 *      user a one-click path.
 *
 * Secret source: UNSUB_SECRET env var ONLY. Must be its own dedicated
 * value, independent of every other secret.
 *
 * SECURITY (2026-05 audit · two independent adversarial passes flagged
 * this HIGH): the previous implementation fell back to
 * HMAC("unsub-derive", CRON_SECRET) when UNSUB_SECRET was unset. That
 * coupled two differently-scoped secrets: CRON_SECRET transits scripts,
 * operator shells, and the submit-vendor notification email body
 * (copy-paste guidance), so its exposure profile is far hotter than a
 * cold signing key's. Worse, the derivation is a fixed public
 * transform — anyone who learned CRON_SECRET could deterministically
 * forge an unsubscribe token for ANY subscriber email (the email is
 * attacker-known; the HMAC is the only control), yielding a one-shot
 * mass-unsubscribe primitive that destroys the alert audience.
 *
 * Now: UNSUB_SECRET is REQUIRED and independent. No CRON_SECRET
 * fallback. If it's missing/too-short we throw — minting/verifying
 * fails CLOSED (the unsubscribe route surfaces a graceful error)
 * rather than silently running on a coupled key. UNSUB_SECRET is
 * listed in the README's required-env table; provision a dedicated
 * 32+ byte random value.
 * ===================================================================== */

function getUnsubSecret(): string {
  const direct = process.env.UNSUB_SECRET;
  // Require a dedicated 32+ byte secret. No derivation from any other
  // secret — different security domains must not share key material.
  if (direct && direct.length >= 32) return direct;
  if (direct && direct.length >= 16) {
    // Present but weak. Still use it (don't silently fall back to a
    // DIFFERENT secret — that's the coupling we're eliminating), but
    // warn loudly so the operator upgrades it.
    console.warn(
      "[subscribe-flow] UNSUB_SECRET is shorter than 32 bytes · " +
        "replace it with a dedicated 32+ byte random value.",
    );
    return direct;
  }
  // Fail CLOSED. Never derive from CRON_SECRET (or anything else).
  throw new Error(
    "UNSUB_SECRET is not set (or <16 bytes). Provision a dedicated " +
      "32+ byte UNSUB_SECRET env var — it must NOT be derived from or " +
      "shared with CRON_SECRET or any other secret.",
  );
}

/**
 * Mint a deterministic unsubscribe token for an email. Same email
 * always produces the same token (stateless). Token includes the
 * email itself (URL-encoded) so the unsubscribe handler doesn't need
 * a database lookup to know who to remove.
 *
 * Token format: `<base64url(email)>.<hmac>`
 */
export function mintUnsubscribeToken(email: string): string {
  const secret = getUnsubSecret();
  const emailLower = email.trim().toLowerCase();
  const emailB64 = Buffer.from(emailLower, "utf-8").toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(emailLower)
    .digest("base64url");
  return `${emailB64}.${sig}`;
}

/**
 * Verify an unsubscribe token and return the email if valid.
 * Constant-time comparison via timingSafeEqual.
 *
 * Returns null on any malformed or signature-mismatch token —
 * caller should render a generic "invalid link" page (no info
 * disclosure about which half failed).
 */
export function verifyUnsubscribeToken(token: string): string | null {
  // Exactly two base64url segments · rejects multi-dot / empty halves
  // (audit residual H-5 · 2026-07-09). Matches mint path in
  // mintUnsubscribeToken (emailB64 + '.' + sig, both base64url).
  if (typeof token !== "string" || token.length > 600) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  const emailB64 = m[1];
  const providedSig = m[2];
  let email: string;
  try {
    email = Buffer.from(emailB64, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  // Sanity: must look like an email and not exceed RFC limits.
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  let expectedSig: string;
  try {
    expectedSig = createHmac("sha256", getUnsubSecret())
      .update(email)
      .digest("base64url");
  } catch {
    return null;
  }
  // Constant-time comparison · mirrors the hardened pattern in
  // lib/cron-auth.ts (2026-05 audit · M-1): NO early `return` on a
  // length mismatch (that reintroduces exactly the timing/length
  // foot-gun cron-auth was fixed to avoid). Pad both buffers to an
  // equal length, run timingSafeEqual unconditionally, then AND the
  // result with a separate length-equality boolean. expectedSig is a
  // fixed-length base64url SHA-256 so the length isn't secret here,
  // but the security-critical compare should follow the codebase's
  // own constant-time standard regardless.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  const len = Math.max(a.length, b.length, 1);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  a.copy(aPad);
  b.copy(bPad);
  const bytesEqual = timingSafeEqual(aPad, bPad);
  const lensEqual = a.length === b.length;
  if (!(bytesEqual && lensEqual)) return null;
  return email;
}

/* =====================================================================
 * Per-subscriber preferences.
 *
 * Stored in KV as `sub:prefs:<email-lowercased>` → JSON. Subscribers
 * without a prefs entry get DEFAULTS (matches the original behavior:
 * alerts at score ≥ 80 / ≤ 20, no weekly digest).
 *
 * Schema is intentionally small. Adding new fields is backward-
 * compatible: missing fields fall back to defaults via the merge in
 * getSubscriberPrefs().
 * ===================================================================== */

export type SubscriberPrefs = {
  // Score >= warmThreshold triggers a "STACK NOW / STACK HUGE" alert.
  // Default 80. Range 60-100 (below 60 the alert would fire constantly
  // — most days the gauge is in the 50-70 range).
  warmThreshold: number;
  // Score <= coldThreshold triggers a "HOLD" alert. Default 20.
  // Range 0-40 (above 40 the alert would fire constantly).
  coldThreshold: number;
  // Opt-in to the Sunday weekly digest. Default false — subscribers
  // signed up for "extreme alerts" not "weekly newsletter."
  digestEnabled: boolean;
  // Opt-in to "regime change" alerts when the gauge tier crosses
  // (WARM→HOT, HOT→MOLTEN, MOLTEN→HOT, etc). Default false to keep
  // existing subscribers strictly opted into extremes only · the
  // tier-flip channel fires from the same check-thresholds cron
  // alongside the extreme alerts, uses its own dedupe key
  // (alerts:lastTier), and excludes recipients who already got an
  // extreme alert in the same cron run to avoid a double-email.
  notifyOnTierChange: boolean;
  // Opt-in to treasury-cheapness alerts · fires when any tracked
  // ticker's mNAV crosses INTO cheap territory (<1.05) on the
  // daily snapshot-treasuries cron. Self-deduping by construction:
  // the cron compares today's mNAV to the previous day's snapshot,
  // so the alert only fires on the day of the crossing, not every
  // day the ticker remains cheap.
  notifyOnMnavCheap: boolean;
  // Symmetric: fires when any tracked ticker's mNAV crosses INTO
  // rich territory (>1.6) on the same snapshot-treasuries cron.
  notifyOnMnavRich: boolean;
  // Opt-in to "imminent strong window" alerts · fires from the
  // daily check-thresholds cron when pickBestWindow returns a cell
  // <24h out with projected score >=70 (HOT zone). Self-deduping
  // via alerts:forecastWindow:lastSent which keys on the exact
  // forecast cell identity (utcDate+etHour), so the same window
  // can never fire twice even if it stays imminent across two cron
  // runs.
  notifyOnForecastWindow: boolean;
  // Opt-in to bitcoin-float milestone alerts · fires when the
  // buyable float drops THROUGH a 500K BTC band (6.5M, 6.0M, 5.5M,
  // ...). Self-deduping by construction: only the day-of-crossing
  // matches "prev > milestone >= today", so the same band can't
  // fire twice. Down-crossings only · a temporary float increase
  // is the opposite of the scarcity narrative this alert is for.
  notifyOnFloatMilestone: boolean;
  // Opt-in to the weekly new-vendors digest · a single email each
  // Sunday listing vendors added/re-verified since the last digest.
  // The lowest-intent traffic on the directory (people who browsed
  // without buying) has had zero reason to return between deploys ·
  // this is the directory-equivalent of the gauge alert. Cadence is
  // weekly to stay well below the "frequent emails are noise"
  // threshold for non-extreme signals.
  notifyOnNewVendors: boolean;
  // Opt-in to /fit allocation-change alerts · the recommend() engine
  // produces a different portfolio for fixed (h, t, a) when live
  // market signals shift (MSTR mNAV trim, F&G regime change, vol
  // band). Subscriber opts in at /fit with their current profile;
  // the weekly check-fit-changes cron recomputes against current
  // snapshot and emails when sleeves get added/removed OR any
  // weight delta crosses 5pp. Stored profile lives under a
  // separate KV key (fit-alert:<email>) since it has structure
  // beyond a boolean.
  notifyOnFitChange: boolean;
  // Opt-in to USA fleet availability pings · fires from the hourly
  // hashrate-available cron when the open-machine count goes up, at
  // most once per UTC day. Default false. The /hashrate waitlist form
  // sets this true via SOURCE_PREFS; existing subscribers opt in at
  // /prefs. First cron run after deploy records a baseline and sends
  // nothing, so a deploy while machines are already open cannot blast
  // the list.
  notifyOnHashrateAvailable: boolean;
  // The ONLY default-ON channel · monthly market-roundup digest
  // sent on the first Sunday of each month. Operator-requested
  // (2026-05-20) as a regular touch-point to keep new sign-ups
  // engaged between extreme-alert events (which may be weeks
  // apart). Rich content: gauge level + 30-day range, cheapest
  // treasury + biggest monthly mover, new vendors landed this
  // month. Subscribers opt OUT via /prefs · existing subscribers
  // are auto-enrolled by the {...DEFAULT_PREFS, ...stored} merge
  // in getSubscriberPrefs (their stored object predates this
  // field, so the default `true` wins on read · zero migration).
  monthlyRoundupEnabled: boolean;
  // When this prefs entry was created/last updated. Useful for
  // future migration / cleanup of orphan prefs (subscriber removed
  // from Resend but prefs record never cleaned up).
  updatedAt: number;
};

export const DEFAULT_PREFS: SubscriberPrefs = {
  warmThreshold: 80,
  coldThreshold: 20,
  digestEnabled: false,
  notifyOnTierChange: false,
  notifyOnMnavCheap: false,
  notifyOnMnavRich: false,
  notifyOnForecastWindow: false,
  notifyOnFloatMilestone: false,
  notifyOnNewVendors: false,
  notifyOnFitChange: false,
  notifyOnHashrateAvailable: false,
  // Only default-ON channel · see field comment above.
  monthlyRoundupEnabled: true,
  updatedAt: 0,
};

const PREFS_KEY = (email: string) => `sub:prefs:${email.trim().toLowerCase()}`;

/**
 * Validate + normalize prefs from untrusted input (form body, etc).
 * Clamps each field to the allowed range; rejects with null on
 * type errors. Used by the subscribe + preferences endpoints.
 */
export function normalizePrefs(input: unknown): SubscriberPrefs | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const warm = Number(o.warmThreshold ?? DEFAULT_PREFS.warmThreshold);
  const cold = Number(o.coldThreshold ?? DEFAULT_PREFS.coldThreshold);
  const digest =
    typeof o.digestEnabled === "boolean"
      ? o.digestEnabled
      : DEFAULT_PREFS.digestEnabled;
  const tierChange =
    typeof o.notifyOnTierChange === "boolean"
      ? o.notifyOnTierChange
      : DEFAULT_PREFS.notifyOnTierChange;
  const mnavCheap =
    typeof o.notifyOnMnavCheap === "boolean"
      ? o.notifyOnMnavCheap
      : DEFAULT_PREFS.notifyOnMnavCheap;
  const mnavRich =
    typeof o.notifyOnMnavRich === "boolean"
      ? o.notifyOnMnavRich
      : DEFAULT_PREFS.notifyOnMnavRich;
  const forecastWindow =
    typeof o.notifyOnForecastWindow === "boolean"
      ? o.notifyOnForecastWindow
      : DEFAULT_PREFS.notifyOnForecastWindow;
  const floatMilestone =
    typeof o.notifyOnFloatMilestone === "boolean"
      ? o.notifyOnFloatMilestone
      : DEFAULT_PREFS.notifyOnFloatMilestone;
  const newVendors =
    typeof o.notifyOnNewVendors === "boolean"
      ? o.notifyOnNewVendors
      : DEFAULT_PREFS.notifyOnNewVendors;
  const fitChange =
    typeof o.notifyOnFitChange === "boolean"
      ? o.notifyOnFitChange
      : DEFAULT_PREFS.notifyOnFitChange;
  const hashrateAvailable =
    typeof o.notifyOnHashrateAvailable === "boolean"
      ? o.notifyOnHashrateAvailable
      : DEFAULT_PREFS.notifyOnHashrateAvailable;
  const monthlyRoundup =
    typeof o.monthlyRoundupEnabled === "boolean"
      ? o.monthlyRoundupEnabled
      : DEFAULT_PREFS.monthlyRoundupEnabled;

  if (!Number.isFinite(warm) || !Number.isFinite(cold)) return null;
  // Range clamps. We refuse — not silently clamp — values way out of
  // range, since it implies a buggy/malicious caller.
  if (warm < 60 || warm > 100) return null;
  if (cold < 0 || cold > 40) return null;
  // Hard invariant: warm strictly above cold. Otherwise the cron
  // logic would alert ambiguously.
  if (warm <= cold + 20) return null;

  return {
    warmThreshold: Math.round(warm),
    coldThreshold: Math.round(cold),
    digestEnabled: digest,
    notifyOnTierChange: tierChange,
    notifyOnMnavCheap: mnavCheap,
    notifyOnMnavRich: mnavRich,
    notifyOnForecastWindow: forecastWindow,
    notifyOnFloatMilestone: floatMilestone,
    notifyOnNewVendors: newVendors,
    notifyOnFitChange: fitChange,
    notifyOnHashrateAvailable: hashrateAvailable,
    monthlyRoundupEnabled: monthlyRoundup,
    updatedAt: Date.now(),
  };
}

const OTHER_HASHRATE_CHANNELS: (keyof SubscriberPrefs)[] = [
  "notifyOnTierChange",
  "notifyOnMnavCheap",
  "notifyOnMnavRich",
  "notifyOnForecastWindow",
  "notifyOnFloatMilestone",
  "notifyOnNewVendors",
  "notifyOnFitChange",
];

/**
 * Prefs written by the /hashrate waitlist form from 2026-08-08 until
 * notifyOnHashrateAvailable existed: { digestEnabled: true } only.
 * The headline was "Ping me when a USA machine frees up." Defaulting
 * the new flag to true for every subscriber would email the /stack
 * and /today lists. This fingerprint is that old hashrate bundle:
 * digest only, other notify channels off, and the new flag absent.
 * An explicit false at /prefs is an opt-out and is left alone.
 */
export function looksLikeLegacyHashrateWaitlist(
  stored: Partial<SubscriberPrefs> | null | undefined,
): boolean {
  if (!stored || stored.digestEnabled !== true) return false;
  if (typeof stored.notifyOnHashrateAvailable === "boolean") return false;
  for (const k of OTHER_HASHRATE_CHANNELS) {
    if (stored[k] === true) return false;
  }
  return true;
}

export function interpretStoredPrefs(
  stored: Partial<SubscriberPrefs> | null | undefined,
): SubscriberPrefs {
  if (!stored) return { ...DEFAULT_PREFS };
  const merged = { ...DEFAULT_PREFS, ...stored };
  if (looksLikeLegacyHashrateWaitlist(stored)) {
    merged.notifyOnHashrateAvailable = true;
  }
  return merged;
}

/**
 * Read this subscriber's preferences. Returns defaults if no prefs
 * record exists, KV is unconfigured, or the stored JSON is malformed.
 */
export async function getSubscriberPrefs(
  email: string,
): Promise<SubscriberPrefs> {
  return (await getSubscriberPrefsChecked(email)).prefs;
}

/**
 * Prefs plus WHETHER WE ACTUALLY READ THEM.
 *
 * getSubscriberPrefs cannot tell "this subscriber has no prefs record"
 * from "the KV read failed", because both surface as null. For the ten
 * default-FALSE channels that is harmless: a failed read yields false and
 * nothing is sent. `monthlyRoundupEnabled` is the ONE default-ON channel,
 * so there the same null silently converts an explicit opt-OUT back into
 * an opt-IN, and a subscriber who unticked the box gets the email during
 * any Upstash blip. Consent must fail CLOSED, so send decisions on a
 * default-ON channel use this and skip `ok:false`.
 *
 * KV being UNCONFIGURED returns ok:true on purpose: opt-outs live in KV,
 * so if there is no KV there is no opt-out to miss.
 */
export async function getSubscriberPrefsChecked(
  email: string,
): Promise<{ ok: boolean; prefs: SubscriberPrefs }> {
  if (!isKvConfigured()) return { ok: true, prefs: DEFAULT_PREFS };
  const { ok, value } = await kvGetChecked<Partial<SubscriberPrefs>>(
    PREFS_KEY(email),
  );
  if (!ok) return { ok: false, prefs: DEFAULT_PREFS };
  if (!value) return { ok: true, prefs: { ...DEFAULT_PREFS } };
  // Merge stored over defaults — handles future schema additions
  // gracefully (missing fields fall back to current defaults).
  return { ok: true, prefs: interpretStoredPrefs(value) };
}

/**
 * Write this subscriber's preferences. No TTL — prefs persist as
 * long as the subscriber does. Returns true on success.
 */
export async function setSubscriberPrefs(
  email: string,
  prefs: SubscriberPrefs,
): Promise<boolean> {
  if (!isKvConfigured()) return false;
  return await kvSet(PREFS_KEY(email), prefs);
}

/**
 * Delete prefs for an email (called on unsubscribe to clean up).
 * Idempotent — no-op if no prefs exist.
 */
export async function deleteSubscriberPrefs(email: string): Promise<boolean> {
  if (!isKvConfigured()) return true;
  return await kvDel(PREFS_KEY(email));
}
