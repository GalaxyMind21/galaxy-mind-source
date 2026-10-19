// POST /api/subscribe — Buying Gauge alert sign-up.
//
// Layered hardening (each independently optional via env vars):
//
//   1. Body cap (always on) — 8KB max so an attacker can't OOM us.
//      (Sized to fit Turnstile interactive-challenge tokens which can
//      hit ~5KB; the original 1KB cap silently rejected legitimate
//      captchas. See MAX_BODY_BYTES below.)
//   2. Email validation (always on) — length + RFC-5321-ish regex.
//   3. Turnstile captcha — when TURNSTILE_SECRET_KEY is set; otherwise
//      skipped silently (form just submits without captcha).
//   4. Rate limit — when KV is configured; 5 requests per IP per hour.
//      KV unset → no rate limit, falls back to current behavior.
//   5. Double-opt-in via magic link — when KV is configured. The /api/
//      subscribe endpoint stashes a pending token + emails the link;
//      /api/subscribe/confirm validates the token and pushes to Resend.
//      KV unset → immediate add (current behavior preserved).
//
// Each layer degrades gracefully so the route is deployable without any
// new env vars and tightens incrementally as KV/Turnstile come online.

import { NextResponse } from "next/server";
import {
  subscribeEmail,
  sendTransactionalEmail,
  renderConfirmEmail,
} from "@/lib/email";
import {
  checkSubscribeRateLimit,
  createPendingSubscribe,
  normalizePrefs,
  normalizeSubscribeSource,
  DEFAULT_PREFS,
  type SubscriberPrefs,
} from "@/lib/subscribe-flow";
import { verifyTurnstileToken, isTurnstileConfigured } from "@/lib/turnstile";
import { isKvConfigured, kvIncrWithTtl } from "@/lib/kv";
import { getClientIp as sharedClientIp } from "@/lib/client-ip";
import { createHash } from "crypto";

// H5 (audit 2026-05) · per-DESTINATION-EMAIL cooldown for the DOI
// confirmation send, INDEPENDENT of the per-IP limit. Without this,
// an attacker rotating IPs (or exploiting any per-IP fail-open)
// could POST {email:"victim@x"} repeatedly and mailbomb the victim
// from our verified Resend domain — burning Resend quota and
// torching sender-domain reputation that the real alert system
// depends on. Keyed on a sha256 of the lowercased email (never the
// raw address — no PII / injection in the KV key). Max 3 confirmation
// sends per address per hour.
const EMAIL_CD_WINDOW_S = 3600;
const EMAIL_CD_MAX = 3;
async function emailSendAllowed(email: string): Promise<boolean> {
  if (!isKvConfigured()) return true; // no KV → can't track; IP limit only
  const h = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  const n = await kvIncrWithTtl(`subscribe:email-cd:${h}`, EMAIL_CD_WINDOW_S);
  // Fail OPEN on KV error here (n===null): the per-IP limit + Turnstile
  // still apply, and we'd rather not block a legit signup on a KV blip.
  if (n === null) return true;
  return n <= EMAIL_CD_MAX;
}

// 8 KB body cap. Cloudflare Turnstile "managed challenge" tokens
// are routinely 1.5–3 KB (interactive challenges can hit ~5 KB).
// Email is hard-capped at 254 chars elsewhere, so the only other
// field is the turnstile token — 8 KB is comfortably above observed
// token sizes while still small enough to defeat OOM abuse.
const MAX_BODY_BYTES = 8 * 1024;

// Local thin wrapper around the shared lib helper so the call site
// reads identically to the previous code. The previous implementation
// (split(",")[0]) was wrong: it returned the attacker-controlled
// first XFF value rather than Vercel's appended trusted IP. See
// lib/client-ip.ts for the full audit-2026-05-14 fix writeup.
function clientIp(request: Request): string {
  return sharedClientIp(request);
}

/**
 * Read the raw body as text with a strict byte cap. Reads the body
 * as a single string (Vercel's runtime already buffers POST bodies in
 * memory, so streaming-cancel doesn't actually save us memory — but
 * it's cheap enough that we cap defensively after read). Critically,
 * this does NOT trust the client's Content-Length header — the prior
 * version of this guard was bypassable by sending a chunked-transfer
 * body or omitting Content-Length entirely (Number(null ?? "0") === 0
 * → guard skipped → arbitrary body parsed into memory).
 *
 * Returns either the body string or a Response object the caller
 * should return immediately.
 */
async function readCappedBody(
  request: Request,
): Promise<{ ok: true; raw: string } | { ok: false; response: NextResponse }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch (e) {
    console.error("[/api/subscribe] body read failed:", e);
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Could not read request body." },
        { status: 400 },
      ),
    };
  }
  // Byte length, NOT character length — emoji + multi-byte chars
  // count properly.
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_BODY_BYTES) {
    // Log the actual size so a future regression of the body-cap-too-tight
    // class (like the 1KB-vs-Turnstile bug) surfaces immediately in
    // Vercel logs instead of staying silent for weeks.
    console.error(
      `[/api/subscribe] body-too-large: ${bytes} bytes (cap ${MAX_BODY_BYTES})`,
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "Body too large.",
          // Diagnostic context for clients — useful for debugging
          // future captcha-token bloat without revealing internals.
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
  // Body size guard — read first, then verify size from the actual
  // bytes (NOT the client-supplied Content-Length header, which is
  // trivially spoofable / omittable).
  const bodyRead = await readCappedBody(request);
  if (!bodyRead.ok) return bodyRead.response;

  let body: { email?: unknown; turnstileToken?: unknown };
  try {
    body = JSON.parse(bodyRead.raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  if (typeof body?.email !== "string") {
    return NextResponse.json(
      { ok: false, error: "Email is required." },
      { status: 400 },
    );
  }

  const ip = clientIp(request);

  // Turnstile FIRST when configured (same order as /api/submit-vendor).
  // Captcha is free; kvIncrWithTtl is metered. Limiter-first lets a
  // captcha-fail flood burn the KV budget, then every limiter fails open.
  if (isTurnstileConfigured()) {
    const token =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    const verify = await verifyTurnstileToken(token, ip);
    if (!verify.ok) {
      console.error("[/api/subscribe] turnstile failed:", verify.reason);
      return NextResponse.json(
        { ok: false, error: "Captcha failed. Refresh and try again." },
        { status: 400 },
      );
    }
  }

  const rl = await checkSubscribeRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many requests. Try again in an hour.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSeconds),
        },
      },
    );
  }

  const email = body.email.trim().toLowerCase();

  // Optional preferences (warm/cold thresholds, digest opt-in).
  // If the body has a `prefs` object, validate + carry it through DOI;
  // otherwise the subscriber gets defaults. Bad prefs → 400 (don't
  // silently strip — better to tell the user "your numbers are out
  // of range" than to ignore their input).
  type IncomingBody = { prefs?: unknown; source?: unknown };
  const rawPrefs = (body as IncomingBody).prefs;
  // Validate the whole bundle for range/invariant errors, then keep ONLY the
  // keys the client actually sent. normalizePrefs default-fills every missing
  // key, and the confirm route merges { ...existing, ...requested } · without
  // this projection a one-channel re-opt-in carried default-false for every
  // OTHER channel and wiped a returning subscriber's prior opt-ins and custom
  // thresholds (2026-07-10 bug audit · H2).
  let requestedPrefs: Partial<SubscriberPrefs> | null = null;
  if (rawPrefs !== undefined) {
    const validated = normalizePrefs(rawPrefs);
    if (validated === null) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid prefs. warmThreshold must be 60-100, coldThreshold 0-40, " +
            "and warm must be at least 20 above cold.",
        },
        { status: 400 },
      );
    }
    const sent = rawPrefs as Record<string, unknown>;
    const sparse: Partial<SubscriberPrefs> = {};
    for (const key of Object.keys(DEFAULT_PREFS) as (keyof SubscriberPrefs)[]) {
      if (key !== "updatedAt" && key in sent) {
        Object.assign(sparse, { [key]: validated[key] });
      }
    }
    requestedPrefs = sparse;
  }
  // Source channel · drives the confirmation email subject/body +
  // post-confirm CTA so the user lands BACK where they came from
  // (previously every channel was hardcoded to /stack). Defaults
  // to "stack" if the client doesn't pass it (legacy callers).
  const source = normalizeSubscribeSource((body as IncomingBody).source);

  // Double-opt-in path — only when KV is configured (we need to stash
  // the pending token somewhere). Otherwise fall back to immediate
  // add for backward compat.
  if (isKvConfigured()) {
    // First, validate the email format before sending anything. Reuses
    // the validation in lib/email.ts by attempting a "dry run" — we
    // call subscribeEmail later only on confirm. For validation here
    // we use the same regex inline.
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Invalid email format." },
        { status: 400 },
      );
    }

    // H5 · per-destination-email cooldown BEFORE minting a token or
    // sending. If exceeded, return the SAME generic success response
    // (anti-enumeration: an attacker learns nothing about whether the
    // address exists / was already mailed; a real double-submitter
    // already has the earlier confirmation email, so "Check your
    // inbox" is still true and correct UX). Silently throttles the
    // mailbomb without a distinguishable signal.
    if (!(await emailSendAllowed(email))) {
      return NextResponse.json(
        { ok: true, kind: "pending", message: "Check your inbox to confirm." },
        { status: 200 },
      );
    }

    const pending = await createPendingSubscribe(
      email,
      requestedPrefs ?? undefined,
      undefined,
      source,
    );
    if (!pending.ok) {
      console.error("[/api/subscribe] DOI token mint failed:", pending.error);
      return NextResponse.json(
        { ok: false, error: "Service unavailable. Try again later." },
        { status: 503 },
      );
    }

    // Use the canonical production domain instead of request.url —
    // on Vercel preview deploys (or any non-prod environment),
    // request.url contains the preview hostname (e.g.
    // foo-git-main-org.vercel.app). Preview deployments are
    // garbage-collected within hours, so a confirmation link
    // pointing there becomes permanently dead. Hardcoded prod
    // domain ensures the link always resolves.
    const confirmUrl = new URL(
      "/api/subscribe/confirm",
      "https://galaxymind.space",
    );
    confirmUrl.searchParams.set("token", pending.token);
    const { subject, html } = renderConfirmEmail({
      confirmUrl: confirmUrl.toString(),
      source,
    });
    const sent = await sendTransactionalEmail({
      to: email,
      subject,
      html,
    });
    if (!sent.ok) {
      console.error("[/api/subscribe] confirm email failed:", sent.error);
      return NextResponse.json(
        { ok: false, error: "Could not send confirmation email." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        kind: "pending",
        message: "Check your inbox to confirm.",
      },
      { status: 200 },
    );
  }

  // Fallback path — no KV, immediate add (preserves the original behavior
  // when running without a KV provisioned).
  const result = await subscribeEmail(email);
  if (result.ok) {
    return NextResponse.json({ ok: true, kind: "added" }, { status: 200 });
  }
  switch (result.kind) {
    case "validation":
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    case "config":
      console.error("[/api/subscribe] config error:", result.error);
      return NextResponse.json(
        { ok: false, error: "Service unavailable. Try again later." },
        { status: 503 },
      );
    case "upstream":
      console.error(
        "[/api/subscribe] upstream error:",
        result.statusCode,
        result.error,
      );
      return NextResponse.json(
        { ok: false, error: "Could not subscribe. Try again later." },
        { status: 503 },
      );
  }
}
