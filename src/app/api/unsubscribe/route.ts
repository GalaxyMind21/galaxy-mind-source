// /api/unsubscribe?token=… — email unsubscribe endpoint.
//
// VERB SPLIT (audit 2026-05 · scanner-prefetch defense):
//   • GET  → renders a CONFIRMATION page. Does NOT mutate. The token
//            is HMAC-verified read-only so we can show an "invalid
//            link" page early, but no contact is removed on GET.
//   • POST → performs the actual unsubscribe (verify → Resend DELETE
//            → prefs cleanup → success page).
//
// Why the split: corporate mail security gateways (Microsoft Defender
// SafeLinks, Barracuda, Mimecast, Proofpoint) PREFETCH every URL in an
// inbound email to scan it. If GET mutated, merely *delivering* an
// alert email to a protected mailbox would silently unsubscribe the
// recipient. RFC 8058 anticipates exactly this and mandates POST for
// one-click unsubscribe — so:
//
// Reached from:
//   1. The visible "Unsubscribe" link in the footer of every alert
//      email → GET → confirmation page → user clicks the button →
//      POST → removed. One extra click, but immune to link-scanner
//      prefetch and accidental hover-prefetch.
//   2. The List-Unsubscribe / List-Unsubscribe-Post headers. Gmail /
//      Apple Mail / Outlook render a native "Unsubscribe" button that
//      POSTs `List-Unsubscribe=One-Click` directly here (RFC 8058) —
//      that path is instant (no confirmation page), which is correct:
//      the mail client already collected the user's intent.
//
// Token is a stateless HMAC of the email — see lib/subscribe-flow.ts
// `mintUnsubscribeToken`. No KV lookup needed; the token IS the proof.
//
// Idempotent: POSTing twice (or a native one-click POST followed by a
// manual confirm) is harmless. Resend's DELETE on an already-removed
// contact returns 200/no-op.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  deleteSubscriberPrefs,
  verifyUnsubscribeToken,
} from "@/lib/subscribe-flow";
import { unsubscribeEmail } from "@/lib/email";
import { kvIncrWithTtl, isKvConfigured } from "@/lib/kv";

// Same minimal-page palette as the confirm route, kept in sync with
// globals.css.
const ONE_CLICK_MAX_BYTES = 512;
const ACCENT = "#F7931A";
const BG = "#12110F";
const ELEVATED = "#1C1A16";
const BORDER = "#26262C";
const TEXT_PRIMARY = "#F2EFE9";
const TEXT_SECONDARY = "#A5A096";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlPage(opts: {
  title: string;
  heading: string;
  message: string;
  variant: "success" | "error";
}): string {
  const accent = opts.variant === "success" ? ACCENT : "#FB923C";
  const title = esc(opts.title);
  const heading = esc(opts.heading);
  const message = esc(opts.message);
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
    <a href="https://galaxymind.space/stack">Back to the gauge →</a>
  </div>
</body>
</html>`;
}

function htmlResponse(html: string, status: number): NextResponse {
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Per-token, never shared. A CDN/proxy must not cache an
      // unsubscribe confirm or result page (token in URL → cache-key
      // bleed risk + stale "you're unsubscribed" served to the wrong
      // request). Also prevents browsers back-button-restoring the
      // confirm form into a re-POST.
      "Cache-Control": "no-store, max-age=0",
      // Defense-in-depth: this is a no-plugin, no-frame HTML utility
      // page. A tight inline CSP closes XSS even though every
      // interpolated value already goes through esc().
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// Confirmation page shown on GET. Renders a POST form so the actual
// removal only happens on an explicit user action (button click) or a
// native RFC-8058 one-click POST — never on a passive GET prefetch.
// The token rides in the form action as a query param (it's already a
// URL-safe HMAC); esc() still applies for the HTML-attribute context.
function confirmPage(token: string): string {
  const action = `/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Confirm unsubscribe · Galaxy Mind</title>
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
    <div class="label">Unsubscribe</div>
    <h1>Confirm unsubscribe</h1>
    <p>Click the button below to stop receiving Buying Gauge alerts. We ask for one click so an email scanner can't unsubscribe you by accident.</p>
    <form method="POST" action="${esc(action)}">
      <button type="submit">Yes, unsubscribe me</button>
    </form>
    <a class="secondary" href="https://galaxymind.space/stack">Keep my alerts → back to the gauge</a>
  </div>
</body>
</html>`;
}

// Shared error pages so GET (read-only verify) and POST (mutating)
// can't drift in copy/status.
function missingTokenResponse(): NextResponse {
  return htmlResponse(
    htmlPage({
      title: "Unsubscribe · Invalid link",
      heading: "Link missing token.",
      message:
        "This unsubscribe URL is missing its token. Try the link in your most recent alert email.",
      variant: "error",
    }),
    400,
  );
}

function invalidTokenResponse(): NextResponse {
  // Generic message — don't disclose whether the token was malformed
  // vs signature-mismatch (no info value to a real user, some
  // info value to a probing attacker).
  return htmlResponse(
    htmlPage({
      title: "Unsubscribe · Invalid link",
      heading: "This unsubscribe link is invalid.",
      message:
        "The link may have been mangled by your email client. Use the unsubscribe link in your most recent alert email.",
      variant: "error",
    }),
    400,
  );
}

// POST-only: actually removes the contact. Token is re-verified here
// independently — the GET-side verification result is never trusted/
// carried over (a POST can arrive directly via RFC 8058 one-click
// without any preceding GET).
async function handle(token: string): Promise<NextResponse> {
  if (!token) return missingTokenResponse();
  const email = verifyUnsubscribeToken(token);
  if (!email) return invalidTokenResponse();
  const result = await unsubscribeEmail(email);
  if (!result.ok) {
    console.error(
      "[/api/unsubscribe] Resend DELETE failed for",
      email,
      ":",
      result.error,
    );
    // Don't echo the email back to the user (avoids enumeration if a
    // bad-token URL somehow reached this branch). Offer a friendly
    // service-error page; the user can always email us.
    return htmlResponse(
      htmlPage({
        title: "Unsubscribe · Service unavailable",
        heading: "Couldn't unsubscribe right now.",
        message:
          "Something went wrong on our end. Try the link again in a few minutes, or reply to your alert email and we'll remove you manually.",
        variant: "error",
      }),
      503,
    );
  }
  // Best-effort cleanup of any persisted prefs — keeps KV tidy and
  // means a re-subscribe later starts fresh instead of inheriting old
  // threshold preferences. Failure here doesn't change the user-facing
  // outcome (they're already removed from the audience).
  await deleteSubscriberPrefs(email).catch((e) => {
    console.error("[/api/unsubscribe] prefs cleanup failed for", email, ":", e);
  });

  return htmlResponse(
    htmlPage({
      title: "Unsubscribe · Done",
      heading: "You're unsubscribed.",
      message:
        "You won't receive any more Buying Gauge alerts. If this was a mistake, you can re-subscribe at any time on the page below.",
      variant: "success",
    }),
    200,
  );
}

// GET is READ-ONLY · it never removes a contact. It renders a
// confirmation page (or an early invalid-link page). This is what
// makes the visible footer link immune to mail-gateway link
// prefetching (Defender SafeLinks / Barracuda / Mimecast) and
// browser hover-prefetch — those issue GETs, and a GET here has no
// side effect.
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return missingTokenResponse();
  // Pure HMAC check (constant-time, see lib/subscribe-flow.ts) — no
  // KV, no Resend call, no mutation. Surfacing the invalid-link page
  // here just saves the user a pointless POST round-trip.
  if (!verifyUnsubscribeToken(token)) return invalidTokenResponse();
  return htmlResponse(confirmPage(token), 200);
}

// RFC 8058 / List-Unsubscribe-Post — Gmail / Apple Mail / Outlook's
// native "Unsubscribe" button sends a POST with
// `List-Unsubscribe=One-Click` in the body to the URL we declared in
// the List-Unsubscribe header. The confirmation page's button also
// POSTs here. POST is the ONLY verb that mutates.
//
// CSRF gate (audit 2026-05-21 · CRITICAL):
//
// Without an origin check, ANY page on the open web could trigger
// `fetch("https://galaxymind.space/api/unsubscribe?token=...", {method:"POST",
// mode:"no-cors"})` and silently remove the recipient. Combined with a
// hypothetical UNSUB_SECRET leak (which would let an attacker mint
// tokens for any email), this is a one-shot mass-unsubscribe primitive
// that could destroy the alert audience. The gate accepts only two
// legitimate POST origins:
//
//   1. Same-origin POST from our confirmation page (the visible
//      "Confirm unsubscribe" button) · Sec-Fetch-Site = "same-origin"
//   2. RFC 8058 native one-click POST from a mail-client server
//      (Gmail / Apple Mail / Outlook) · Sec-Fetch-Site header is
//      ABSENT (server-to-server fetch) AND the body carries the
//      `List-Unsubscribe=One-Click` marker mandated by the spec
//
// Anything else (`cross-site`, `same-site`, an arbitrary value, or
// absent-without-the-marker) returns the generic invalid-link page ·
// no info disclosure to the attacker.
//
// Per-token rate limit:
//
// Even with the CSRF gate, a leaked token could be replayed in a
// loop. The rate limit (5 POSTs/hour per token hash) makes
// brute-force replay observable in logs and bounds the damage from
// a single leaked token to 120/day worst-case. KV-backed; fails
// OPEN when KV is unavailable (better to permit a legit unsubscribe
// than block on a transient KV blip).
async function isLegitOriginPOST(
  req: NextRequest,
): Promise<{ ok: boolean; reason?: string }> {
  const sfs = req.headers.get("sec-fetch-site");

  // Same-origin POST from our confirmation page (the "Confirm
  // unsubscribe" button submits a form). "none" covers the user
  // hitting the URL directly in the address bar then submitting,
  // which Chrome reports as Sec-Fetch-Site: none.
  if (sfs === "same-origin" || sfs === "none") {
    return { ok: true };
  }

  // Email-client native one-click (RFC 8058) · server-to-server
  // fetch from the mail provider's infrastructure has NO
  // Sec-Fetch-Site header at all AND the spec mandates the body
  // contain `List-Unsubscribe=One-Click`. Both signals together
  // distinguish a real Gmail/Apple-Mail POST from a CSRF.
  if (sfs === null) {
    try {
      // RFC 8058's body is a fixed short form-encoded string (~26 bytes),
      // so anything bigger is not a one-click POST. This read is the only
      // pre-auth work on the route with no bound on it: the origin gate
      // runs BEFORE verifyUnsubscribeToken, and the per-token limiter
      // runs after it, so an unverified caller could make us buffer a
      // multi-megabyte body just to look for a 25-character marker.
      // Declared length is the cheap filter; measured length is the
      // authority, since content-length can lie or be absent.
      const declared = Number(req.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > ONE_CLICK_MAX_BYTES) {
        return { ok: false, reason: "body too large" };
      }
      const body = await req.text();
      if (body.length > ONE_CLICK_MAX_BYTES) {
        return { ok: false, reason: "body too large" };
      }
      if (body.includes("List-Unsubscribe=One-Click")) {
        return { ok: true };
      }
      return { ok: false, reason: "missing one-click marker" };
    } catch {
      return { ok: false, reason: "body read failed" };
    }
  }

  // sfs is "cross-site" or "same-site" or some odd value · reject.
  return { ok: false, reason: `sec-fetch-site=${sfs}` };
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  // Origin gate · accept only legit confirmation-page / RFC-8058
  // POSTs. Reject CSRF + cross-site abuse with the generic
  // invalid-link page so the attacker can't distinguish "you got
  // blocked by the origin check" from "the token was wrong."
  const originCheck = await isLegitOriginPOST(req);
  if (!originCheck.ok) {
    console.warn(
      "[/api/unsubscribe] POST origin rejected:",
      originCheck.reason,
    );
    return invalidTokenResponse();
  }

  // VERIFY BEFORE METERING (audit 2026-07-25).
  //
  // The per-token limiter below writes a KV key derived from the
  // caller-supplied token. Running it first meant every unauthenticated
  // POST minted a brand-new `unsubscribe:rl:<hash>` key with a 1h TTL
  // before the HMAC was ever checked — so a script posting random tokens
  // (the origin gate is passable: with no Sec-Fetch-Site header it only
  // requires the body string `List-Unsubscribe=One-Click`) turned into
  // unbounded distinct keys plus one command each against the KV budget
  // the whole site shares. The GET path already verified before doing any
  // work; POST now matches it.
  //
  // verifyUnsubscribeToken is pure HMAC with zero I/O, so this is free —
  // and it means only a VALID token can ever cause a KV write. handle()
  // re-verifies independently (see its comment); that stays.
  if (!token) return missingTokenResponse();
  if (!verifyUnsubscribeToken(token)) return invalidTokenResponse();

  // Per-token rate limit · caps replay of a single leaked token at
  // 5/hour. Hash the token (not the raw token) so KV inspection
  // never exposes the credential.
  if (isKvConfigured() && token.length > 0) {
    const tokenHash = createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 32);
    const count = await kvIncrWithTtl(
      `unsubscribe:rl:${tokenHash}`,
      3600,
    );
    if (count != null && count > 5) {
      console.warn(
        "[/api/unsubscribe] per-token rate limit hit:",
        tokenHash,
      );
      // 429 with no body · don't echo anything that helps the
      // attacker iterate. The legitimate retry path is to wait
      // an hour (or contact support, who can manually unsubscribe).
      return new NextResponse(null, { status: 429 });
    }
  }

  return handle(token);
}
