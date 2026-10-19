// POST /api/fit-alerts — /fit allocation-change opt-in.
//
// Subscriber lands on /fit, dials in {horizon, tolerance, account},
// gets a recommendation, then opts in to "email me when this
// recommendation changes." This route:
//
//   1. Validates the body (email + h/t/a tuple) and Turnstile.
//   2. Rate-limits per IP and per destination email (reuses the
//      same KV-backed helpers as /api/subscribe — same abuse model:
//      knowing someone's email shouldn't let you mailbomb them).
//   3. Computes the BASELINE recommendation server-side from the
//      current market snapshot (so the cron's later diff has a
//      trusted reference point — never trust the client to say
//      "here was my last seen allocation").
//   4. Goes through the existing DOI flow so no fit-alert KV record
//      materializes for an unverified email. The pending token
//      carries the prefs (with notifyOnFitChange:true) AND the
//      fit-alert baseline; the confirm route writes both.
//   5. If KV is unconfigured, falls back to immediate add via
//      subscribeEmail() · the fit-alert KV record won't persist
//      (KV unavailable), but the email signup still works. Operators
//      will rarely run this path in prod.
//
// Idempotent: a returning subscriber re-opting-in via /fit gets a
// fresh confirmation email; on confirm the fit-alert record is
// overwritten with the latest baseline (v1 design: one profile per
// email · re-opt-in supersedes).

import { NextResponse } from "next/server";
import {
  subscribeEmail,
  sendTransactionalEmail,
  renderConfirmEmail,
} from "@/lib/email";
import {
  checkSubscribeRateLimit,
  createPendingSubscribe,
  DEFAULT_PREFS,
  getSubscriberPrefs,
  setSubscriberPrefs,
} from "@/lib/subscribe-flow";
import { verifyTurnstileToken, isTurnstileConfigured } from "@/lib/turnstile";
import {
  isKvConfigured,
  kvIncrWithTtl,
  kvSet,
} from "@/lib/kv";
import { getClientIp } from "@/lib/client-ip";
import { createHash } from "crypto";
import { getMarketSnapshot } from "@/lib/market";
import { recommend } from "@/lib/recommend";
import type { AccountType, Tolerance } from "@/lib/recommend";
import {
  fitAlertKey,
  marketSignalsFrom,
  snapshotFromRec,
  type FitAlertRecord,
} from "@/lib/fit-alert";

// 8KB to match /api/subscribe (Turnstile interactive tokens ~5KB).
const MAX_BODY_BYTES = 8 * 1024;

// Per-email confirmation send cooldown · mirrors /api/subscribe H5.
// Knowing a victim's email shouldn't let an attacker burn Resend
// quota by spamming opt-in confirmations.
const EMAIL_CD_WINDOW_S = 3600;
const EMAIL_CD_MAX = 3;
async function emailSendAllowed(email: string): Promise<boolean> {
  if (!isKvConfigured()) return true;
  const h = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  // Shared key namespace with /api/subscribe so an attacker can't
  // route around the limit by alternating endpoints.
  const n = await kvIncrWithTtl(`subscribe:email-cd:${h}`, EMAIL_CD_WINDOW_S);
  if (n === null) return true;
  return n <= EMAIL_CD_MAX;
}

function isAccountType(v: unknown): v is AccountType {
  return v === "taxable" || v === "traditional" || v === "roth";
}

function isTolerance(v: unknown): v is Tolerance {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= 6
  );
}

async function readCappedBody(
  request: Request,
): Promise<{ ok: true; raw: string } | { ok: false; response: NextResponse }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch (e) {
    console.error("[/api/fit-alerts] body read failed:", e);
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Could not read request body." },
        { status: 400 },
      ),
    };
  }
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_BODY_BYTES) {
    console.error(
      `[/api/fit-alerts] body-too-large: ${bytes} bytes (cap ${MAX_BODY_BYTES})`,
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "Body too large.",
          observedBytes: bytes,
          maxBytes: MAX_BODY_BYTES,
        },
        { status: 413 },
      ),
    };
  }
  return { ok: true, raw };
}

export async function POST(request: Request) {
  const bodyRead = await readCappedBody(request);
  if (!bodyRead.ok) return bodyRead.response;

  let body: {
    email?: unknown;
    h?: unknown;
    t?: unknown;
    a?: unknown;
    turnstileToken?: unknown;
  };
  try {
    body = JSON.parse(bodyRead.raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  // ---- Field validation ------------------------------------------
  // JSON.parse("null") SUCCEEDS, so a 4-byte body of `null` sails past the
  // try/catch above and the first property read below throws — an opaque
  // 500 on a route whose every other rejection is a typed 400. Same guard
  // submit-vendor and prefs already use.
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  if (typeof body.email !== "string") {
    return NextResponse.json(
      { ok: false, error: "Email is required." },
      { status: 400 },
    );
  }
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Invalid email format." },
      { status: 400 },
    );
  }

  // Coerce h to integer years (UI uses 1-30). Reject if non-finite
  // or out of band · the engine has its own filters but the cron
  // computes against this value weekly, so we want it clean at the
  // door.
  const h = Number(body.h);
  if (!Number.isFinite(h) || h < 1 || h > 30 || !Number.isInteger(h)) {
    return NextResponse.json(
      { ok: false, error: "Horizon must be an integer 1–30 years." },
      { status: 400 },
    );
  }
  if (!isTolerance(body.t)) {
    return NextResponse.json(
      { ok: false, error: "Tolerance must be an integer 1–6." },
      { status: 400 },
    );
  }
  if (!isAccountType(body.a)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Account must be one of: taxable, traditional, roth.",
      },
      { status: 400 },
    );
  }
  const t: Tolerance = body.t;
  const a: AccountType = body.a;

  // ---- Defense layers --------------------------------------------
  const ip = getClientIp(request);
  if (isTurnstileConfigured()) {
    const token =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    const verify = await verifyTurnstileToken(token, ip);
    if (!verify.ok) {
      console.error("[/api/fit-alerts] turnstile failed:", verify.reason);
      return NextResponse.json(
        { ok: false, error: "Captcha failed. Refresh and try again." },
        { status: 400 },
      );
    }
  }

  const rl = await checkSubscribeRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again in an hour." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  // ---- Baseline recommendation -----------------------------------
  // Compute server-side so the cron's later diff is anchored to a
  // trusted snapshot. Never trust the client to say "here was my
  // last seen allocation" — they could spoof a baseline that makes
  // every weekly check look like a meaningful change (spam vector).
  let baseline: FitAlertRecord;
  try {
    const snapshot = await getMarketSnapshot();
    const rec = recommend({
      horizonYears: h,
      volatilityTolerance: t,
      accountType: a,
      ...marketSignalsFrom(snapshot),
    });
    baseline = {
      h,
      t,
      a,
      lastRec: snapshotFromRec(rec),
      lastSentAt: 0,           // hasn't sent yet · sentinel for "no prior"
      optedInAt: Date.now(),
    };
  } catch (e) {
    console.error("[/api/fit-alerts] baseline recommend failed:", e);
    return NextResponse.json(
      { ok: false, error: "Service unavailable. Try again later." },
      { status: 503 },
    );
  }

  // Compose the prefs payload · default-bundle + this opt-in flipped
  // on. The DOI confirm route merges via setSubscriberPrefs (overwrite
  // semantics) which means we'd lose any OTHER prefs an existing
  // subscriber had configured. To avoid that, read their current
  // prefs first and merge OUR pref into theirs.
  const existing = await getSubscriberPrefs(email);
  const mergedPrefs = {
    ...DEFAULT_PREFS,
    ...existing,
    notifyOnFitChange: true,
    updatedAt: Date.now(),
  };

  // ---- DOI path (KV configured) ----------------------------------
  if (isKvConfigured()) {
    if (!(await emailSendAllowed(email))) {
      // Anti-enumeration: same generic success as /api/subscribe.
      return NextResponse.json(
        { ok: true, kind: "pending", message: "Check your inbox to confirm." },
        { status: 200 },
      );
    }

    // source="fit" · drives the channel-aware subject + post-confirm
    // CTA so this subscriber lands back on /fit (not /stack) after
    // clicking the magic link.
    const pending = await createPendingSubscribe(
      email,
      mergedPrefs,
      baseline,
      "fit",
    );
    if (!pending.ok) {
      console.error("[/api/fit-alerts] DOI token mint failed:", pending.error);
      return NextResponse.json(
        { ok: false, error: "Service unavailable. Try again later." },
        { status: 503 },
      );
    }

    const confirmUrl = new URL(
      "/api/subscribe/confirm",
      "https://galaxymind.space",
    );
    confirmUrl.searchParams.set("token", pending.token);
    const { subject, html } = renderConfirmEmail({
      confirmUrl: confirmUrl.toString(),
      source: "fit",
    });
    const sent = await sendTransactionalEmail({
      to: email,
      subject,
      html,
    });
    if (!sent.ok) {
      console.error("[/api/fit-alerts] confirm email failed:", sent.error);
      return NextResponse.json(
        { ok: false, error: "Could not send confirmation email." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: true, kind: "pending", message: "Check your inbox to confirm." },
      { status: 200 },
    );
  }

  // ---- Fallback path (no KV) -------------------------------------
  // No DOI possible without KV. Mirror /api/subscribe's fallback ·
  // immediate add. Prefs + fit-alert writes silently no-op (kvSet
  // returns false) which is fine: the route still returns ok so the
  // user gets confirmation, and the operator surely knows their KV
  // is missing.
  const result = await subscribeEmail(email);
  if (!result.ok) {
    switch (result.kind) {
      case "validation":
        return NextResponse.json(
          { ok: false, error: result.error },
          { status: 400 },
        );
      case "config":
        console.error("[/api/fit-alerts] config error:", result.error);
        return NextResponse.json(
          { ok: false, error: "Service unavailable. Try again later." },
          { status: 503 },
        );
      case "upstream":
        console.error(
          "[/api/fit-alerts] upstream error:",
          result.statusCode,
          result.error,
        );
        return NextResponse.json(
          { ok: false, error: "Could not subscribe. Try again later." },
          { status: 503 },
        );
    }
  }
  await setSubscriberPrefs(email, mergedPrefs);
  await kvSet(fitAlertKey(email), baseline);
  return NextResponse.json({ ok: true, kind: "added" }, { status: 200 });
}
