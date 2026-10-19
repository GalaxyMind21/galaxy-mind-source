// /api/subscribe/confirm?token=… — double-opt-in magic-link endpoint.
//
// VERB SPLIT (audit 2026-07-25 · scanner-prefetch defense) — mirrors the
// /api/unsubscribe twin, which was split for exactly this reason:
//   • GET  → renders a CONFIRMATION page. Does NOT mutate. The pending
//            token is PEEKED (never consumed) so we can still show an
//            accurate expired/malformed page.
//   • POST → performs the opt-in (Resend audience add → consume token →
//            prefs → fit-alert baseline → welcome email → success page).
//
// Why the split. Corporate mail security gateways (Microsoft Defender
// SafeLinks, Barracuda, Mimecast, Proofpoint) PREFETCH every URL in an
// inbound email to scan it. While GET mutated, that had two effects:
//
//   1. CONSENT: an attacker could POST /api/subscribe with someone
//      else's address, and the victim's own scanning gateway would
//      complete the opt-in on delivery — subscribing them to a list they
//      never clicked. That voids the entire purpose of double opt-in
//      (lib/subscribe-flow.ts: "without it, a malicious actor can
//      subscribe other people's emails") and made the confirmation
//      email's promise — "no action means you won't receive any further
//      messages" — false.
//   2. WORSE FOR REAL USERS: the prefetch CONSUMED the token, so the
//      genuine subscriber's own click then hit `not-found` and rendered
//      the 410 "Link expired or already used." page. Their signup had
//      actually succeeded but looked broken. The peek-then-delete design
//      exists to avoid exactly that dead end, and prefetch routed
//      around it.
//
// Why HTML, not JSON: the visitor lands here from their email client
// — they want to see "you're confirmed" in their browser, not a JSON
// blob. A minimal styled page matching the site design works.

import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_PREFS,
  deletePendingSubscribeToken,
  getSubscriberPrefs,
  peekPendingSubscribe,
  setSubscriberPrefs,
} from "@/lib/subscribe-flow";
import {
  renderWelcomeEmail,
  sendTransactionalEmail,
  subscribeEmail,
  unsubscribeHeadersFor,
} from "@/lib/email";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { fitAlertKey } from "@/lib/fit-alert";
import { kvSet } from "@/lib/kv";

// 16-color palette aligned with src/app/globals.css.
const ACCENT = "#F7931A";
const BG = "#12110F";
const ELEVATED = "#1C1A16";
const BORDER = "#26262C";
const TEXT_PRIMARY = "#F2EFE9";
const TEXT_SECONDARY = "#A5A096";

// HTML-escape helper for any string interpolated into the page body.
// All current call sites use static literals, but the function
// signature accepts arbitrary strings — if any future code path
// passes user/upstream content (e.g., embedding the email address in
// a message) it would be a stored XSS without escaping. Defense in
// depth.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Per-source CTA on the success page (audit 2026-05-21 followup ·
// operator flagged that every confirmation landing page bounced
// subscribers to /stack regardless of which channel they signed up
// for). Unknown / error states default to "stack" (the legacy
// behavior · still a valid surface to land on).
import type { SubscribeSource } from "@/lib/subscribe-flow";

const CTA_BY_SOURCE: Record<SubscribeSource, { url: string; label: string }> = {
  stack: { url: "https://galaxymind.space/stack", label: "View the gauge →" },
  fit: { url: "https://galaxymind.space/fit", label: "Back to /fit →" },
  treasuries: {
    url: "https://galaxymind.space/treasuries",
    label: "View treasuries →",
  },
  float: { url: "https://galaxymind.space/float", label: "View the float →" },
  vendors: { url: "https://galaxymind.space/", label: "Browse the directory →" },
  today: {
    url: "https://galaxymind.space/today",
    label: "Open today's briefing →",
  },
  seo: {
    url: "https://galaxymind.space/today",
    label: "Open today's briefing →",
  },
  hashrate: {
    url: "https://galaxymind.space/hashrate",
    label: "Back to rent hashrate →",
  },
};

// What the visitor is confirming, per channel · shown on the GET page so
// the click is informed consent, not a blind button.
const CONFIRM_BLURB: Record<SubscribeSource, string> = {
  stack:
    "You're confirming email alerts for the Bitcoin Buying Gauge — only when it crosses an extreme threshold, typically a few times a month.",
  fit: "You're confirming /fit allocation-change alerts — a weekly check that only emails you when the engine actually shifts.",
  treasuries:
    "You're confirming treasury alerts — an email when a tracked treasury (MSTR / MPJPY / XXI / ASST) goes cheap.",
  float:
    "You're confirming float alerts — an email when the buyable bitcoin float crosses a 500K BTC milestone.",
  vendors:
    "You're confirming the weekly new-merchant digest — one quiet Sunday list, skipped on weeks when nothing new lands.",
  today:
    "You're confirming your daily-briefing channels — extreme gauge days, float milestones, and the weekly digest.",
  seo: "You're confirming email alerts for the Bitcoin Buying Gauge — only when it crosses an extreme threshold.",
  hashrate:
    "You're confirming hashrate availability pings — we'll email when a Galaxy Mind USA machine frees up to rent. Low volume, not a daily newsletter.",
};

function htmlPage(opts: {
  title: string;
  heading: string;
  message: string;
  variant: "success" | "error";
  // Optional source · drives the CTA URL + label so users land back
  // where they came from. Defaults to "stack" for legacy / error
  // paths that don't know the source.
  source?: SubscribeSource;
}): string {
  const accent = opts.variant === "success" ? ACCENT : "#FB923C";
  // Escape every opts.* string so a future caller passing user input
  // (mistakenly or otherwise) can't inject markup.
  const title = esc(opts.title);
  const heading = esc(opts.heading);
  const message = esc(opts.message);
  const cta = CTA_BY_SOURCE[opts.source ?? "stack"] ?? CTA_BY_SOURCE.stack;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${title} · Galaxy Mind</title>
  <style>
    body { margin:0; padding:0; background:${BG}; color:${TEXT_PRIMARY};
      font-family: ui-sans-serif, system-ui, sans-serif;
      min-height: 100vh; display: flex; align-items: center;
      justify-content: center; padding: 24px; }
    .card { max-width: 480px; width: 100%; background:${ELEVATED};
      border: 1px solid ${BORDER}; border-radius: 16px; padding: 40px 32px;
      text-align: center; }
    .label { font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase;
      color: ${TEXT_SECONDARY}; margin-bottom: 12px; }
    h1 { font-size: 28px; font-weight: 600; margin: 0 0 16px;
      color: ${accent}; letter-spacing: -0.02em; }
    p { font-size: 14px; line-height: 1.55; color: ${TEXT_SECONDARY};
      margin: 0 0 24px; }
    a { display: inline-block; background: ${accent}; color: ${BG};
      text-decoration: none; font-family: ui-monospace, monospace;
      font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;
      font-weight: 600; padding: 14px 28px; border-radius: 8px;
      box-shadow: 0 0 24px ${accent}55; transition: background 0.15s; }
    a:hover { background: #ffa733; }
  </style>
</head>
<body>
  <div class="card">
    <div class="label">${title}</div>
    <h1>${heading}</h1>
    <p>${message}</p>
    <a href="${cta.url}">${esc(cta.label)}</a>
  </div>
</body>
</html>`;
}

/**
 * The GET landing page: a button that POSTs. Deliberately mirrors the
 * /api/unsubscribe confirm page. The token rides the form ACTION (same
 * as the twin, and the POST handler already reads it from the query), and
 * the subscriber's email is NEVER echoed here — that would turn a
 * guessed or leaked token into an address discloser.
 */
function htmlConfirmPage(token: string, source: SubscribeSource): string {
  const action = `/api/subscribe/confirm?token=${encodeURIComponent(token)}`;
  const what = CONFIRM_BLURB[source] ?? CONFIRM_BLURB.stack;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Confirm subscription · Galaxy Mind</title>
  <style>
    body { margin:0; padding:0; background:${BG}; color:${TEXT_PRIMARY};
      font-family: ui-sans-serif, system-ui, sans-serif;
      min-height: 100vh; display: flex; align-items: center;
      justify-content: center; padding: 24px; }
    .card { max-width: 480px; width: 100%; background:${ELEVATED};
      border: 1px solid ${BORDER}; border-radius: 16px; padding: 40px 32px;
      text-align: center; }
    .label { font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 12px; letter-spacing: 0.3em; text-transform: uppercase;
      color: ${TEXT_SECONDARY}; margin-bottom: 12px; }
    h1 { font-size: 28px; font-weight: 600; margin: 0 0 16px;
      color: ${ACCENT}; letter-spacing: -0.02em; }
    p { font-size: 14px; line-height: 1.55; color: ${TEXT_SECONDARY};
      margin: 0 0 24px; }
    button { display: inline-block; background: ${ACCENT}; color: ${BG};
      border: 0; cursor: pointer; font-family: ui-monospace, monospace;
      font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;
      font-weight: 600; padding: 14px 28px; border-radius: 8px;
      box-shadow: 0 0 24px ${ACCENT}55; transition: background 0.15s; }
    button:hover { background: #ffa733; }
    .secondary { display:block; margin-top:20px; font-size:12px;
      color:${TEXT_SECONDARY}; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="label">Subscription</div>
    <h1>Confirm your subscription</h1>
    <p>${esc(what)} We ask for one click so an email scanner can&#39;t subscribe you by accident.</p>
    <form method="POST" action="${esc(action)}">
      <button type="submit">Yes, sign me up</button>
    </form>
    <a class="secondary" href="https://galaxymind.space/">No thanks → galaxymind.space</a>
  </div>
</body>
</html>`;
}

function htmlResponse(html: string, status: number): NextResponse {
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Mirrors the /api/unsubscribe twin (audit 2026-07-25 · this page
      // is the same shape — a token-in-URL HTML utility page — but had
      // none of the twin's hardening).
      //
      // Per-token, never shared: a CDN/proxy must not cache a
      // confirmation result keyed on a URL carrying a live opt-in token.
      "Cache-Control": "no-store, max-age=0",
      // Defense-in-depth: a no-plugin, no-frame page. Every interpolated
      // value already goes through esc(); this closes XSS regardless.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      // Without this the sitewide strict-origin-when-cross-origin
      // policy still sends the FULL URL on same-origin navigations — so
      // clicking the success page's "View the gauge →" CTA leaked
      // ?token=… in the Referer. no-referrer closes it.
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * Shared token lookup for both verbs. PEEKS only — never consumes — so
 * GET can render an accurate page without mutating, and POST re-does the
 * same lookup independently (a POST can arrive straight from the confirm
 * form without us trusting any GET-side state).
 *
 * Returns either the pending payload or the exact error page to serve, so
 * the two verbs cannot drift in copy or status code.
 */
async function lookupToken(token: string): Promise<
  | {
      ok: true;
      value: Extract<
        Awaited<ReturnType<typeof peekPendingSubscribe>>,
        { kind: "ok" }
      >;
    }
  | { ok: false; response: NextResponse }
> {
  if (!token) {
    return {
      ok: false,
      response: htmlResponse(
        htmlPage({
          title: "Subscription · Invalid link",
          heading: "Link missing token.",
          message:
            "This confirmation URL doesn't contain a token. The link may have been mangled by your email client.",
          variant: "error",
        }),
        400,
      ),
    };
  }
  const consume = await peekPendingSubscribe(token);
  if (consume.kind === "ok") {
    return { ok: true, value: consume };
  }
  if (consume.kind === "kv-unconfigured") {
    // Service-level config error — surface as 503 so external
    // monitoring can flag it; user-facing copy is still friendly.
    return {
      ok: false,
      response: htmlResponse(
        htmlPage({
          title: "Subscription · Service unavailable",
          heading: "Email alerts are temporarily disabled.",
          message: "Our team has been notified. Please try again later.",
          variant: "error",
        }),
        503,
      ),
    };
  }
  if (consume.kind === "malformed") {
    return {
      ok: false,
      response: htmlResponse(
        htmlPage({
          title: "Subscription · Invalid link",
          heading: "This confirmation link looks malformed.",
          message:
            "Your email client may have mangled the URL. Try copy-pasting the full link from the email.",
          variant: "error",
        }),
        400,
      ),
    };
  }
  // kind === "not-found"
  return {
    ok: false,
    response: htmlResponse(
      htmlPage({
        title: "Subscription · Expired",
        heading: "Link expired or already used.",
        message:
          "Confirmation links work once and expire after 24 hours. Sign up again to receive a fresh one.",
        variant: "error",
      }),
      410, // Gone
    ),
  };
}

/**
 * GET · READ-ONLY. Renders the confirm button. Never mutates, so a mail
 * gateway prefetching this URL changes nothing and does not consume the
 * token (see the verb-split note at the top of this file).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const found = await lookupToken(token);
  if (!found.ok) return found.response;
  return htmlResponse(htmlConfirmPage(token, found.value.source), 200);
}

/** POST · performs the opt-in. Reached from the GET page's form. */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  // PEEK the token rather than consume · we delete only AFTER
  // subscribeEmail succeeds so a Resend hiccup mid-confirm doesn't
  // burn a still-valid token. The user can re-submit the same confirm
  // form to retry; subscribeEmail itself is idempotent. The outcome
  // discrimination (503 / 400 / 410 rather than one misleading
  // "expired") lives in lookupToken so GET and POST cannot drift.
  const found = await lookupToken(token);
  if (!found.ok) return found.response;
  const consume = found.value;
  const email = consume.email;
  const requestedPrefs = consume.prefs;
  const requestedFitAlert = consume.fitAlert;
  const source = consume.source;

  const result = await subscribeEmail(email);
  if (!result.ok) {
    console.error(
      "[/api/subscribe/confirm] subscribe failed for",
      email,
      ":",
      result,
    );
    // Token is preserved · user can re-click the same magic link
    // to retry once Resend recovers.
    return htmlResponse(
      htmlPage({
        title: "Subscription · Failed",
        heading: "Couldn't add you to alerts.",
        message:
          "Something went wrong on our end. The confirmation link is still valid · try clicking it again in a moment.",
        variant: "error",
      }),
      503,
    );
  }

  // Subscribe succeeded · NOW consume the token so it can't be
  // re-used. Errors here are tolerable (token will be re-deleted on
  // re-click; subscribeEmail is idempotent).
  await deletePendingSubscribeToken(token);

  // Persist preferences if the subscriber sent a prefs bundle at
  // signup. MERGE over existing (audit 2026-07-10): channel opt-ins
  // send a *partial* bundle (e.g. { notifyOnFloatMilestone: true }).
  // normalizePrefs fills defaults for missing keys — a full overwrite
  // would wipe custom thresholds / other channel prefs on re-subscribe.
  // Mirror /api/fit-alerts: {...DEFAULT_PREFS, ...existing, ...incoming}.
  if (requestedPrefs) {
    const existing = await getSubscriberPrefs(email);
    const merged = {
      ...DEFAULT_PREFS,
      ...existing,
      ...requestedPrefs,
      updatedAt: Date.now(),
    };
    const prefsOk = await setSubscriberPrefs(email, merged);
    if (!prefsOk) {
      console.error(
        "[/api/subscribe/confirm] prefs persist failed for",
        email,
        "· falling back to defaults",
      );
    }
  }

  // Persist the /fit allocation-change baseline if the subscriber
  // opted in via /fit. Same best-effort discipline as prefs · the
  // cron silently no-ops on subscribers without a fit-alert record,
  // so a missed write just means no /fit-change alerts for them
  // (they can re-opt-in to retry). Stored under a separate KV key
  // (fit-alert:<email>) so the structured profile doesn't collide
  // with the boolean-heavy prefs bundle.
  if (requestedFitAlert) {
    const fitOk = await kvSet(fitAlertKey(email), requestedFitAlert);
    if (!fitOk) {
      console.error(
        "[/api/subscribe/confirm] fit-alert persist failed for",
        email,
      );
    }
  }

  // Welcome email · re-enabled per operator request (2026-05-20
  // round 2). Distinguishing factors from the magic-link email so
  // it doesn't read as a duplicate: subject + body lead with the
  // live score ("You're in. The Buying Gauge is currently X/100"),
  // includes a Saylor quote in the brand-voice footer, and the
  // visual treatment is "subscription confirmed" not "click here
  // to confirm." Best-effort awaited (caught + logged) · a missed
  // welcome doesn't fail the user-facing confirmation page since
  // they're already in the Resend audience.
  try {
    const snapshot = await getMarketSnapshot();
    const verdict = computeStackVerdict(snapshot);
    const welcome = renderWelcomeEmail({
      recipientEmail: email,
      currentScore: verdict.score,
      currentTier: TIER_LABEL[verdict.tier],
      // Source threads from the DOI pending payload so /fit subscribers
      // get a /fit-themed welcome, not the legacy "Buying Gauge is
      // currently X/100" subject + gauge-score card (fixed 2026-05-21).
      source,
    });
    const sendRes = await sendTransactionalEmail({
      to: email,
      subject: welcome.subject,
      html: welcome.html,
      headers: unsubscribeHeadersFor(email),
    });
    if (!sendRes.ok) {
      console.error(
        "[/api/subscribe/confirm] welcome email send failed for",
        email,
        ":",
        sendRes.error,
      );
    }
  } catch (e) {
    console.error("[/api/subscribe/confirm] welcome email exception:", e);
  }

  // Channel-aware success message (audit 2026-05-21 followup).
  // Maps each source to the cadence + scope copy that matches the
  // channel the user signed up for, so the success page reflects
  // what they actually subscribed to rather than the generic gauge
  // line. Unknown / legacy sources fall back to the stack copy.
  const SUCCESS_MSG: Record<SubscribeSource, string> = {
    stack:
      "Welcome email is on its way. We'll only contact you when the Buying Gauge crosses an extreme threshold (typically a few times a month). Unsubscribe anytime via any email.",
    fit:
      "Welcome email is on its way. We'll only email you when your /fit recommendation changes meaningfully · weekly check, only fires on meaningful engine shifts. Unsubscribe anytime via any email.",
    treasuries:
      "Welcome email is on its way. We'll only email you when a tracked treasury (MSTR / MPJPY / XXI / ASST) goes cheap (mNAV < 1.05×). One email per crossing. Unsubscribe anytime via any email.",
    float:
      "Welcome email is on its way. We'll only email you when the buyable bitcoin float crosses a 500K BTC milestone. Unsubscribe anytime via any email.",
    vendors:
      "Welcome email is on its way. We'll send you a weekly digest of new bitcoin merchants every Sunday (skipped on weeks when nothing new lands). Unsubscribe anytime via any email.",
    today:
      "Welcome email is on its way. Extreme gauge days, float milestones, and the weekly digest · your daily briefing channels. Open galaxymind.space/today each morning. Unsubscribe anytime via any email.",
    seo:
      "Welcome email is on its way. We'll only contact you when the Buying Gauge crosses an extreme threshold. Come back daily at galaxymind.space/today. Unsubscribe anytime via any email.",
    hashrate:
      "Welcome email is on its way. We'll ping you when a Galaxy Mind USA hashrate machine frees up. Low volume. Unsubscribe anytime via any email.",
  };

  return htmlResponse(
    htmlPage({
      title: "Subscription · Confirmed",
      heading: "You're in.",
      message: SUCCESS_MSG[source] ?? SUCCESS_MSG.stack,
      variant: "success",
      source,
    }),
    200,
  );
}
