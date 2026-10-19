// Thin wrapper around Resend's REST API. We don't pull in the
// `resend` SDK because it ships a few hundred KB of dependencies
// for what amounts to two POST endpoints — and bundle size matters
// here since this file is also used in API routes that cold-start.
//
// Required environment variables (set in Vercel project settings):
//
//   RESEND_API_KEY        — Resend dashboard → API Keys
//   RESEND_AUDIENCE_ID    — Resend dashboard → Audiences → (create one)
//   RESEND_FROM_EMAIL     — a verified sender on the Resend domain
//                           (e.g. "alerts@galaxymind.space" once you
//                           verify the domain in Resend's settings)
//   CRON_SECRET           — random string used as a bearer token to
//                           authenticate the daily cron endpoint
//
// Without RESEND_API_KEY set, all functions return an explicit
// failure marker instead of throwing — so the build/deploy doesn't
// break before the env vars are provisioned.

// kv.ts is dependency-free (no import of email.ts) so this is
// cycle-safe at module top level.
import { kvGet, kvSet, isKvConfigured } from "./kv";
import { pickSaylorQuote } from "./saylor-quotes";
// vendors.ts is a leaf data module (it imports nothing from here), so
// this cannot cycle.
import { vendorBadgeSnippet, STALE_THRESHOLD_DAYS, VENDOR_BADGE } from "./vendors";
import { BADGE_BENEFITS } from "./badge-outreach";
import type { DiffResult, SleeveSnapshot } from "./fit-alert";
import type { AccountType, Tolerance } from "./recommend";
import type { SubscribeSource } from "./subscribe-flow";
import type { QueueEntry } from "./vendor-queue";

/**
 * Email type system (2026-06-20) · mirror the website: a clean sans for
 * prose + headlines, JetBrains-style mono reserved for data, labels,
 * tickers, scores, and button text. Web fonts can't load in email, so
 * these are the closest system stacks. Before this, every template was
 * 100% monospace, which read as a terminal dump next to the refreshed
 * sans-body site. Templates set FONT_SANS on <body> (prose + h1 inherit
 * it) and apply FONT_MONO inline on the mono elements.
 */
const FONT_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

/**
 * Machined-instrument email tokens (refresh 2026-07-09) · lifted from
 * the site instruments (SupplyClock.tsx / DirectoryConsole.tsx) so the
 * transactional emails read as the same warm brass-and-amber hardware.
 *
 * These are LITERAL inline hex / gradient strings, never CSS `var(--x)`
 * · email clients (Gmail, Outlook, Apple Mail) don't resolve custom
 * properties. Every gradient is paired with a solid `background:` painted
 * FIRST so Outlook's Word engine (which strips gradient images) still
 * gets a coherent solid fill · same solid-first pattern as the masthead
 * hairline. box-shadow / text-shadow here are decorative only; nothing
 * relies on them for legibility.
 */
const PANEL_SOLID = "#140d08";
const PANEL_GRADIENT =
  "radial-gradient(120% 100% at 50% 0%,#1d130c 0%,#120b07 50%,#0a0605 100%)";
const PANEL_BORDER = "#2a2622";
const BEZEL_SOLID = "#57514a";
const BEZEL_GRADIENT =
  "linear-gradient(165deg,#8a7f6d,#57514a 16%,#2a2622 42%,#131110 78%,#26221d 100%)";
const DIGIT_AMBER = "#ffd9a0";
const BRASS = "#FFC56F";
const DIM = "rgba(235,225,210,0.66)";
const DIMMER = "rgba(235,225,210,0.55)";
const BRIGHT = "#f2e8d8";

/**
 * Shared "Saylor footer" block used in every outbound email template
 * (welcome, all 7 alert types, weekly digest). One quote per day
 * across all emails via pickSaylorQuote (day-of-year indexed) so the
 * email channel has a unified daily voice instead of random per-
 * message noise. Tinted with the calling template's `accent` color
 * so the quote's left rule visually belongs to that email's
 * character (orange for warm alerts, blue for cold/cooling, etc).
 *
 * Inserted JUST BEFORE the `<hr>` + receipt-disclaimer footer in
 * every template · keeps the legal/unsub line as the last thing the
 * eye lands on while still letting the quote close the brand voice.
 */
function saylorFooterHtml(accent: string): string {
  const quote = pickSaylorQuote();
  return `<div style="margin:24px 0 16px 0;padding:14px 18px;border-left:2px solid ${accent}66;background:rgba(247,147,26,0.03);font-style:italic;font-size:13px;line-height:1.5;color:#A5A096;">
      ${quote}
      <div style="margin-top:6px;font-style:normal;font-size:11px;letter-spacing:0.2em;font-family:${FONT_MONO};text-transform:uppercase;color:#8C8C96;">
        · Michael Saylor
      </div>
    </div>
    ${referralLineHtml(accent)}`;
}

/**
 * "Forward to a friend" referral line · a low-key word-of-mouth loop
 * that rides along in every email (composed into saylorFooterHtml, so
 * it sits just above the legal/unsub footer). The most forward-worthy
 * moment is an alert ("the gauge says STACK NOW") · this gives the
 * reader a frictionless nudge to pass the signal on. No tracking, no
 * per-user referral codes · just a plain link to the site.
 */
function referralLineHtml(accent: string): string {
  return `<div style="margin:16px 0 0 0;padding:13px 16px;border:1px solid #26262C;border-radius:8px;font-size:13px;line-height:1.5;color:#A5A096;">
      <strong style="color:#F2EFE9;font-weight:600;">Know someone stacking sats?</strong>
      Forward this · they'll get the same calm signal you do.
      <a href="https://galaxymind.space" style="color:${accent};text-decoration:none;font-weight:600;white-space:nowrap;">galaxymind.space →</a>
    </div>`;
}

/**
 * Shared masthead (refresh 2026-07-09) · every outbound email opens
 * with the same branded header: the plain GALAXY MIND wordmark left (no
 * currency glyph · house rule), a brass lamp dot + the template's
 * channel label right, and a 2px accent hairline gradient underneath ·
 * the email twin of the site header's .hairline-gradient.
 * Table layout (not flex) because Outlook. The gradient degrades to
 * its first color stop in clients that strip backgrounds · still a
 * clean rule line, never broken layout.
 */
function emailMastheadHtml(label: string, accent: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;border-collapse:collapse;">
      <tr>
        <td style="font-family:${FONT_MONO};font-size:13px;font-weight:700;letter-spacing:0.24em;color:#F2EFE9;white-space:nowrap;padding:0;">
          GALAXY&nbsp;MIND
        </td>
        <td align="right" style="font-family:${FONT_MONO};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${DIM};padding:0;">
          <span style="color:${BRASS};">&#9679;</span>&nbsp;${label}
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding:12px 0 0 0;">
          <!-- Solid background-color FIRST, gradient background-image
               second. Outlook's Word engine drops the gradient image
               and paints the solid #2E2E36 line (a clean divider, not
               an invisible gap · review 2026-07-03). Modern clients
               layer the accent gradient on top: it fades to transparent
               on the right, revealing the solid line beneath, so the
               rule reads full-width, bright accent → subtle line. -->
          <div style="height:2px;line-height:2px;font-size:0;background:#2E2E36;background-image:linear-gradient(90deg,${accent},${accent}1F 55%,rgba(0,0,0,0));border-radius:1px;">&nbsp;</div>
        </td>
      </tr>
    </table>`;
}

/**
 * Footer rule · gradient hairline replacing the old flat <hr>. Fades
 * left-to-right like the site's machined dividers. The solid
 * background-color (#26262C · the old <hr> color) is the Outlook
 * fallback: Word ignores the gradient image, so without it the rule
 * vanished entirely (review 2026-07-03). Modern clients layer the
 * gradient over the solid line.
 */
function emailHairlineHtml(): string {
  return `<div style="height:1px;line-height:1px;font-size:0;background:#26262C;background-image:linear-gradient(90deg,#3A3A42,#26262C 45%,rgba(0,0,0,0));margin:32px 0;">&nbsp;</div>`;
}

/**
 * Machined panel · the email twin of the site's instrument housings.
 * Replaces the old flat `background:#1C1A16` cards with a warm brass
 * bezel ring (1.5px, gradient over solid) wrapping a dark amber-lit
 * panel. Solid-first / gradient-second on both layers so Outlook keeps
 * a coherent fill. `label` renders an optional mono micro-label above
 * the pre-built `body` HTML. `accent` tints the panel's top edge (echoes
 * the old warm `border-top-color` on the cards) · warm/cold per caller.
 */
function emailPanelHtml(opts: {
  accent: string;
  body: string;
  label?: string;
  padding?: string;
  margin?: string;
}): string {
  const pad = opts.padding ?? "20px";
  const mar = opts.margin ?? "24px 0";
  const labelHtml = opts.label
    ? `<div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:${DIM};margin-bottom:8px;">${opts.label}</div>`
    : "";
  return `<div style="padding:1.5px;background:${BEZEL_SOLID};background-image:${BEZEL_GRADIENT};border-radius:9px;margin:${mar};">
      <div style="background:${PANEL_SOLID};background-image:${PANEL_GRADIENT};border:1px solid ${PANEL_BORDER};border-top:1px solid ${opts.accent}55;border-radius:8px;padding:${pad};box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
        ${labelHtml}${opts.body}
      </div>
    </div>`;
}

/**
 * Big readout number · the amber nixie-style digit block from the site's
 * SupplyClock. Warm surfaces light the digits DIGIT_AMBER (not the flat
 * orange accent) with a decorative amber glow; cold surfaces (frozen
 * alert, cooling tier-flip) keep their #7ec0ff so the cold semantic
 * survives. `suffix` (e.g. "/100", " BTC in play") renders dim after the
 * number; `trailing` appends inline HTML (e.g. a tier chip). Each caller
 * passes its own `fontSize` so existing sizes are preserved. A single
 * warm block · no per-digit glass cells (too fragile across clients).
 */
function emailBigNumberHtml(opts: {
  value: string | number;
  fontSize: string;
  accent: string;
  suffix?: string;
  suffixSize?: string;
  margin?: string;
  trailing?: string;
}): string {
  const isCold = opts.accent.toLowerCase() === "#7ec0ff";
  const digit = isCold ? opts.accent : DIGIT_AMBER;
  const glow = isCold
    ? "0 0 8px rgba(126,192,255,0.35)"
    : "0 0 8px rgba(247,147,26,0.35)";
  const suffixHtml = opts.suffix
    ? `<span style="color:${DIMMER};font-size:${opts.suffixSize ?? "18px"};font-weight:400;">${opts.suffix}</span>`
    : "";
  return `<div style="font-size:${opts.fontSize};font-family:${FONT_MONO};font-weight:600;color:${digit};line-height:1;letter-spacing:-0.02em;text-shadow:${glow};margin:${opts.margin ?? "0"};">${opts.value}${suffixHtml}${opts.trailing ?? ""}</div>`;
}

/**
 * Primary CTA button · extracted from the ~11 identical filled-accent
 * links across the templates (pure DRY, no visual change). `accent`
 * fills the button (warm or cold per template); `margin` preserves each
 * caller's original spacing.
 */
function emailButtonHtml(opts: {
  href: string;
  label: string;
  accent: string;
  margin?: string;
}): string {
  return `<a href="${opts.href}" style="display:inline-block;background:${opts.accent};color:#12110F;font-family:${FONT_MONO};font-weight:600;font-size:14px;letter-spacing:0.18em;text-transform:uppercase;padding:14px 28px;border-radius:6px;text-decoration:none;margin:${opts.margin ?? "16px 0"};">
      ${opts.label}
    </a>`;
}

/**
 * Legal / unsubscribe footer block · DRYs the standard two-line footer
 * shared by the digest, welcome, and the five alert templates. `extra`
 * is the template-specific "You're receiving this because…" paragraph
 * (a pre-built <p>), rendered above the constant legal line. `accent`
 * colors the @GalaxyMind link (warm or cold per template). NOT used by
 * renderConfirmEmail (own footer), renderVendorLiveEmail (no unsub), or
 * the fit-change / monthly-roundup templates (bespoke footer copy).
 */
function emailFooterHtml(opts: {
  prefsUrl: string;
  unsubUrl: string;
  accent: string;
  extra?: string;
}): string {
  return `${opts.extra ?? ""}
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      Not financial advice. Built by <a href="https://x.com/GalaxyMind" style="color:${opts.accent};">@GalaxyMind</a>. ·
      <a href="${opts.prefsUrl}" style="color:#A5A096;text-decoration:underline;">Edit preferences</a> ·
      <a href="${opts.unsubUrl}" style="color:#A5A096;text-decoration:underline;">Unsubscribe</a>
    </p>`;
}

const RESEND_API = "https://api.resend.com";

type ResendError = { error: string; statusCode?: number };
type ResendOk<T> = { ok: true; data: T };
type ResendFail = { ok: false; error: string; statusCode?: number };
export type ResendResult<T> = ResendOk<T> | ResendFail;

function isResendConfigured(): {
  apiKey: string;
  audienceId: string;
  from: string;
} | null {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !audienceId || !from) return null;
  return { apiKey, audienceId, from };
}

async function resendFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<ResendResult<T>> {
  try {
    const r = await fetch(`${RESEND_API}${path}`, {
      ...init,
      // Resend can hang; without a ceiling a partial outage pegs the
      // serverless fn (alert cron / subscribe confirm) until Vercel's
      // hard timeout. Respect a caller-supplied signal if present.
      signal: init.signal ?? AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const err = (body as ResendError | null)?.error ?? r.statusText;
      return { ok: false, error: String(err), statusCode: r.status };
    }
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- Public API --------------------------------------------------

/**
 * Subscribe an email to the Buying Gauge alerts audience. Returns
 * { ok: true } on success, { ok: false, error } on validation or
 * Resend-API failure. Idempotent — Resend treats re-adding an
 * existing contact as a no-op.
 */
// RFC 5321 caps total length at 254. Enforced before the regex so a
// malicious 1MB string never reaches the regex engine (cheap defense
// against ReDoS-style payloads against this very simple pattern, and
// against burning Resend audience quota with junk).
const MAX_EMAIL_LENGTH = 254;

// Distinguishable failure mode: the caller (POST /api/subscribe) maps
// `kind: "config"` to HTTP 503, "validation" to 400, "upstream" to 503.
// Without this, a misconfigured Resend key was reported to the user as
// HTTP 400 ("invalid email") which was a lie.
export type SubscribeFailure =
  | { ok: false; kind: "config"; error: string }
  | { ok: false; kind: "validation"; error: string }
  | { ok: false; kind: "upstream"; error: string; statusCode?: number };
export type SubscribeResult =
  | { ok: true; data: { id: string } }
  | SubscribeFailure;

export async function subscribeEmail(email: string): Promise<SubscribeResult> {
  const cfg = isResendConfigured();
  if (!cfg) {
    // Internal-only string. The /api/subscribe route swaps this for a
    // generic "Service unavailable" message before returning to clients
    // so the env var name isn't disclosed.
    return {
      ok: false,
      kind: "config",
      error:
        "Email alerts are not configured yet. Set RESEND_API_KEY, RESEND_AUDIENCE_ID, RESEND_FROM_EMAIL in Vercel.",
    };
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, kind: "validation", error: "Email too long." };
  }
  // Lightweight email format check — Resend will reject malformed
  // addresses anyway, but this avoids the round trip for obvious
  // typos.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, kind: "validation", error: "Invalid email format." };
  }
  const r = await resendFetch<{ id: string }>(
    cfg.apiKey,
    `/audiences/${cfg.audienceId}/contacts`,
    {
      method: "POST",
      body: JSON.stringify({ email, unsubscribed: false }),
    },
  );
  if (!r.ok) {
    return {
      ok: false,
      kind: "upstream",
      error: r.error,
      statusCode: r.statusCode,
    };
  }
  return { ok: true, data: r.data };
}

/**
 * Remove (unsubscribe) an email from the alerts audience. Idempotent —
 * Resend treats removing an already-removed contact as a no-op.
 *
 * Implementation note: Resend's REST contacts API supports DELETE by
 * email. We URL-encode the email so addresses with `+` etc. don't
 * break the path.
 */
export async function unsubscribeEmail(
  email: string,
): Promise<ResendResult<{ contact?: string }>> {
  const cfg = isResendConfigured();
  if (!cfg) return { ok: false, error: "Resend not configured." };
  // Resend uses DELETE /audiences/{id}/contacts/{email_or_id}.
  return resendFetch<{ contact?: string }>(
    cfg.apiKey,
    `/audiences/${cfg.audienceId}/contacts/${encodeURIComponent(email.trim().toLowerCase())}`,
    { method: "DELETE" },
  );
}

/**
 * Fetch all contacts in the alerts audience (one page, up to ~1000
 * — Resend supports pagination for larger lists, not needed at our
 * scale). Returns the email array on success.
 */
export async function listSubscribers(): Promise<
  ResendResult<{ emails: string[] }>
> {
  const cfg = isResendConfigured();
  if (!cfg) return { ok: false, error: "Resend not configured." };
  type ContactsResponse = {
    data?: { email: string; unsubscribed?: boolean }[];
  };
  const r = await resendFetch<ContactsResponse>(
    cfg.apiKey,
    `/audiences/${cfg.audienceId}/contacts`,
    { method: "GET" },
  );
  if (!r.ok) return r;
  const emails = (r.data.data ?? [])
    .filter((c) => !c.unsubscribed)
    .map((c) => c.email);
  return { ok: true, data: { emails } };
}

/**
 * Count active subscribers in the audience. Used by the public-facing
 * /api/subscriber-count endpoint that powers the "Join N others" badge.
 * Returns null on Resend failure (caller should hide the badge rather
 * than show a broken/zero count).
 *
 * H7 (audit 2026-05, Agent3-HIGH): the public, unauthenticated count
 * endpoint called this, which called listSubscribers() — a FULL
 * Resend `GET /audiences/{id}/contacts` that pulled EVERY subscriber
 * email into server memory just to take `.length`. The route's
 * `revalidate=300` is keyed by URL, so `?cb=<rand>` cache-busts it
 * → an attacker spraying unique query strings forced a full
 * email-list pull + Resend quota burn + PII materialization PER
 * request. Now a single integer is cached in KV for 5 min: the
 * expensive list pull happens at most once per 5 min GLOBALLY
 * regardless of request volume / cache-busting, and the full PII
 * list is materialized that rarely instead of per-request. Falls
 * back to the live count if KV is unavailable (badge still works).
 */
const SUB_COUNT_CACHE_KEY = "subscriber:count:cached";
const SUB_COUNT_TTL_S = 300; // 5 min · matches the route's revalidate

export async function countSubscribers(): Promise<number | null> {
  // Hard-require KV (audit 2026-05-21 · MEDIUM): without it, the
  // route's PII-amplification protection (cache the integer, never
  // re-fetch the full email list per request) doesn't exist · cache-
  // busting the /api/subscriber-count edge cache then materializes
  // every subscriber's email in server memory on every request. When
  // KV is unconfigured we return null so the route's badge UI shows
  // "loading" or hides gracefully · much safer than the old fallback
  // path that fetched the full list per request.
  if (!isKvConfigured()) return null;

  // Fast path: serve the cached integer (no Resend call, no PII pull).
  const cached = await kvGet<number>(SUB_COUNT_CACHE_KEY);
  if (typeof cached === "number") return cached;

  // Refresh path · only runs at most once per SUB_COUNT_TTL_S (5 min)
  // because the next request after this one will find the cached
  // value. The expensive Resend list-pull is therefore amortized to
  // ~1 call per 5 min globally regardless of request volume.
  const subs = await listSubscribers();
  if (!subs.ok) return null;
  const count = subs.data.emails.length;
  // Best-effort cache write · don't fail the count if KV write fails.
  await kvSet(SUB_COUNT_CACHE_KEY, count, SUB_COUNT_TTL_S);
  return count;
}

/**
 * Send the Buying Gauge alert email to all subscribers. Uses
 * Resend's batch endpoint — up to 100 emails per call. Larger
 * audiences are chunked.
 *
 * PARTIAL-SUCCESS: returns the count of emails ACTUALLY SENT before
 * any failure. Previously a mid-batch failure returned `{ok: false}`
 * with no count, so an operator seeing the alarm couldn't tell if 0
 * or 80% of the audience got the email — and a manual retry would
 * re-send to those who already received it (no per-subscriber dedup
 * exists). Now the caller can write the dedup state immediately on
 * partial success and skip the retry.
 */
export type SendAlertResult =
  | { ok: true; sent: number }
  | { ok: false; sent: number; error: string; statusCode?: number };

/**
 * Per-recipient HTML renderer. Takes the recipient's email and returns
 * the email body with a unique unsubscribe link spliced in. Lets us
 * give every recipient a tailored unsub URL without duplicating the
 * entire renderAlertEmail template.
 */
export type RecipientHtmlRenderer = (recipientEmail: string) => string;

import { mintUnsubscribeToken } from "./subscribe-flow";

/**
 * Build the List-Unsubscribe header value(s) for a recipient. Modern
 * mail clients (Gmail, Apple Mail, Outlook) parse these and surface a
 * one-click "Unsubscribe" button next to the message. RFC 8058 makes
 * that button POST instead of GET — our /api/unsubscribe route
 * accepts both verbs.
 */
function unsubscribeHeaders(email: string): Record<string, string> {
  // Fail-safe (audit 2026-05-21 · HIGH): mintUnsubscribeToken throws
  // if UNSUB_SECRET is unset/short. Without this catch, ANY outbound
  // alert email (check-thresholds, weekly-digest, monthly-roundup,
  // mnav-alert, fit-change, etc) would throw mid-render the moment
  // the env var goes missing · a single missing secret cascades to
  // a total alert-channel outage. Far better to send the email with
  // a degraded "manage your prefs" link than to silently drop every
  // outbound. Operator-side missing-secret alarms still surface via
  // the UNSUB_SECRET-required check in /api/unsubscribe + /api/prefs.
  let token: string;
  try {
    token = mintUnsubscribeToken(email);
  } catch (e) {
    console.error(
      "[email] unsubscribeHeaders: UNSUB_SECRET unavailable, " +
        "degrading to header-less envelope · email will still send " +
        "but native one-click is disabled. Cause:",
      e,
    );
    return {};
  }
  const url = `https://galaxymind.space/api/unsubscribe?token=${token}`;
  return {
    "List-Unsubscribe": `<${url}>`,
    // RFC 8058 — declares this is a one-click POST, no confirmation page.
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function sendAlertBatch(
  recipients: string[],
  subject: string,
  htmlForRecipient: RecipientHtmlRenderer,
): Promise<SendAlertResult> {
  const cfg = isResendConfigured();
  if (!cfg) return { ok: false, sent: 0, error: "Resend not configured." };
  if (recipients.length === 0) {
    return { ok: true, sent: 0 };
  }
  // Chunk into 100-email batches per Resend's limit.
  const chunks: string[][] = [];
  for (let i = 0; i < recipients.length; i += 100) {
    chunks.push(recipients.slice(i, i + 100));
  }
  let sent = 0;
  for (const chunk of chunks) {
    // Per-recipient payload: unique unsubscribe URL in the body AND
    // in the List-Unsubscribe headers. Resend's batch endpoint
    // accepts a `headers` object per envelope.
    const payload = chunk.map((to) => ({
      from: cfg.from,
      to,
      subject,
      html: htmlForRecipient(to),
      headers: unsubscribeHeaders(to),
    }));
    const r = await resendFetch<{ data: unknown[] }>(cfg.apiKey, "/emails/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      // Return partial-success info so the caller can record what
      // actually went out (and not double-send on a retry).
      return { ok: false, sent, error: r.error, statusCode: r.statusCode };
    }
    sent += chunk.length;
  }
  return { ok: true, sent };
}

/**
 * Send a single transactional email (not a batch). Used by the
 * double-opt-in flow to send the confirmation magic link.
 *
 * Returns the same {ok,error} shape as resendFetch — caller decides
 * how to surface failure.
 */
export async function sendTransactionalEmail(opts: {
  // Resend accepts a string or string[]. Pass an array when the same
  // message must land in more than one inbox (e.g. social drafts →
  // SOCIAL_DRAFTS_EMAIL + SUBMISSION_NOTIFY_EMAIL).
  to: string | string[];
  subject: string;
  html: string;
  // Extra MIME headers (e.g. List-Unsubscribe). Optional — the DOI
  // confirmation email doesn't need them (subscribers haven't opted
  // in yet), but the welcome email does.
  headers?: Record<string, string>;
}): Promise<ResendResult<{ id: string }>> {
  const cfg = isResendConfigured();
  if (!cfg) return { ok: false, error: "Resend not configured." };
  return resendFetch<{ id: string }>(cfg.apiKey, "/emails", {
    method: "POST",
    body: JSON.stringify({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.headers ? { headers: opts.headers } : {}),
    }),
  });
}

/**
 * Ask Resend what actually HAPPENED to a message we already sent.
 *
 * WHY THIS EXISTS (2026-09-11). `sendTransactionalEmail` resolves ok
 * when Resend ACCEPTS the message, which is the most any synchronous
 * caller can know — the bounce arrives minutes later, out of band. So
 * the social-drafts cron logged `action: "sent"`, returned 200, burned
 * the 14-day vendor cooldowns, and showed green on the Vercel cron
 * dashboard on two days (2026-09-03 and 2026-09-11) when the message
 * bounced downstream and the operator got nothing. Acceptance is
 * not delivery, and nothing in this repo had ever checked the
 * difference: there are zero Resend webhooks configured, so there is
 * no push channel either.
 *
 * `bounced` is true ONLY on an explicit bounce. A failed read, an
 * unconfigured Resend, or a status this function does not recognise
 * all report `bounced: false` — an alarm that fires on ignorance gets
 * muted, and the caller escalates to a 503 on this signal.
 *
 * The status field is read from `last_event` OR `status`, and matched
 * on substring, deliberately: this is Resend's shape rather than ours,
 * and the alternative was guessing one field name correctly without a
 * way to verify it from here.
 */
export type EmailDelivery = {
  /** Resend's own terminal event, verbatim, for logging. */
  status: string;
  /** True only for a confirmed bounce. */
  bounced: boolean;
};

export async function fetchEmailDelivery(
  id: string,
): Promise<ResendResult<EmailDelivery>> {
  const cfg = isResendConfigured();
  if (!cfg) return { ok: false, error: "Resend not configured." };
  const res = await resendFetch<{ last_event?: string; status?: string }>(
    cfg.apiKey,
    `/emails/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
  if (!res.ok) return res;
  const raw = res.data?.last_event ?? res.data?.status ?? "";
  const status = String(raw || "unknown");
  return {
    ok: true,
    data: { status, bounced: status.toLowerCase().includes("bounce") },
  };
}

/**
 * Build the per-recipient unsubscribe URL — used by templates that
 * need the visible footer link (alert + welcome emails). The URL is
 * the same one carried in the List-Unsubscribe header above.
 *
 * Fail-safe (audit 2026-05-21 · HIGH): if UNSUB_SECRET is unset/short,
 * mintUnsubscribeToken throws. Without this catch every alert email
 * render would throw mid-template, cascading to a total alert-channel
 * outage on a single missing env var. Degrades to a tokenless /prefs
 * URL · the recipient can still navigate to manage their prefs
 * (after authenticating via re-subscribe), AND the missing-secret
 * condition still hard-fails the /api/unsubscribe + /api/prefs
 * verification routes so the alarm is preserved.
 */
export function buildUnsubscribeUrl(email: string): string {
  try {
    const token = mintUnsubscribeToken(email);
    return `https://galaxymind.space/api/unsubscribe?token=${token}`;
  } catch (e) {
    console.error(
      "[email] buildUnsubscribeUrl: UNSUB_SECRET unavailable, " +
        "degrading to a /prefs URL with no token. Cause:",
      e,
    );
    return "https://galaxymind.space/prefs";
  }
}

/**
 * Build a per-recipient /prefs link. Same HMAC token as unsubscribe ·
 * the /api/prefs route reuses verifyUnsubscribeToken so we don't need
 * a separate credential to mint or rotate. Linked next to the unsub
 * URL in every email footer so subscribers can edit one opt-in
 * without re-signing-up.
 *
 * Same fail-safe as buildUnsubscribeUrl.
 */
export function buildPrefsUrl(email: string): string {
  try {
    const token = mintUnsubscribeToken(email);
    return `https://galaxymind.space/prefs?token=${token}`;
  } catch (e) {
    console.error(
      "[email] buildPrefsUrl: UNSUB_SECRET unavailable, " +
        "degrading to /prefs with no token. Cause:",
      e,
    );
    return "https://galaxymind.space/prefs";
  }
}

/**
 * Build the headers we want set on every per-subscriber outbound —
 * exposed so the welcome email (which uses sendTransactionalEmail
 * not the batch path) can include them. Same value the alert batch
 * sets internally.
 */
export function unsubscribeHeadersFor(email: string): Record<string, string> {
  return unsubscribeHeaders(email);
}

/**
 * Render the double-opt-in confirmation email. Visitor clicks the link
 * to actually subscribe — no click means no add to the audience.
 *
 * Static HTML matching the design system (same template style as
 * renderAlertEmail). Plain inline styles for email-client compat.
 */
// Per-source confirmation-email copy (audit 2026-05-21 followup ·
// operator flagged that every confirm email was hardcoded to the
// /stack vocabulary regardless of which channel the user signed up
// for). Subject + body lead + footer link each pivot on the source.
// Unknown sources fall through to "stack" (the historical default).
const CONFIRM_COPY: Record<
  SubscribeSource,
  { subject: string; lead: string; footerLabel: string; footerUrl: string }
> = {
  stack: {
    subject: "Confirm your Buying Gauge alert subscription",
    lead:
      "We&apos;ll email you when the Bitcoin Buying Gauge crosses an extreme " +
      "threshold (score ≥ 80 or ≤ 20). Typically a few times a month, never " +
      "more than once a day.",
    footerLabel: "galaxymind.space/stack",
    footerUrl: "https://galaxymind.space/stack",
  },
  fit: {
    subject: "Confirm your /fit allocation-change alerts",
    lead:
      "We&apos;ll email you when your recommended portfolio changes meaningfully · " +
      "a sleeve added/removed, or any weight moves ≥5pp. Weekly check; only " +
      "fires on meaningful engine shifts, not jitter.",
    footerLabel: "galaxymind.space/fit",
    footerUrl: "https://galaxymind.space/fit",
  },
  treasuries: {
    subject: "Confirm your treasury mNAV alerts",
    lead:
      "We&apos;ll email you when any tracked treasury (MSTR / MPJPY / XXI / " +
      "ASST) goes cheap (mNAV &lt; 1.05×). One email per crossing · self-deduping.",
    footerLabel: "galaxymind.space/treasuries",
    footerUrl: "https://galaxymind.space/treasuries",
  },
  float: {
    subject: "Confirm your Bitcoin Float milestone alerts",
    lead:
      "We&apos;ll email you when the buyable bitcoin float crosses a 500K BTC " +
      "round number (6.5M → 6.0M → 5.5M, etc). Down-crossings only · the " +
      "scarcity moments.",
    footerLabel: "galaxymind.space/float",
    footerUrl: "https://galaxymind.space/float",
  },
  vendors: {
    subject: "Confirm your new-merchant weekly digest",
    lead:
      "We&apos;ll send you a weekly digest of new bitcoin merchants added to " +
      "the directory. Sundays only · skipped on weeks when nothing new lands.",
    footerLabel: "galaxymind.space",
    footerUrl: "https://galaxymind.space/",
  },
  today: {
    subject: "Confirm your Galaxy Mind daily briefing alerts",
    lead:
      "We&apos;ll email you on extreme gauge days, float milestones, and the " +
      "weekly digest · so the morning briefing stays honest without opening a tab.",
    footerLabel: "galaxymind.space/today",
    footerUrl: "https://galaxymind.space/today",
  },
  seo: {
    subject: "Confirm your Buying Gauge extreme alerts",
    lead:
      "We&apos;ll email you when the Bitcoin Buying Gauge crosses an extreme " +
      "threshold (score ≥ 80 or ≤ 20). Typically a few times a month.",
    footerLabel: "galaxymind.space/today",
    footerUrl: "https://galaxymind.space/today",
  },
  hashrate: {
    subject: "Confirm your USA fleet waitlist",
    lead:
      "We&apos;ll email you when another Galaxy Mind USA machine opens. " +
      "At most one email a day, and nothing while the open count stays flat.",
    footerLabel: "galaxymind.space/hashrate",
    footerUrl: "https://galaxymind.space/hashrate",
  },
};

export function renderConfirmEmail(opts: {
  confirmUrl: string;
  // Defaults to "stack" for legacy callers · the source threads
  // through from /api/subscribe + /api/fit-alerts via the DOI
  // pending payload.
  source?: SubscribeSource;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const copy = CONFIRM_COPY[opts.source ?? "stack"] ?? CONFIRM_COPY.stack;
  const subject = copy.subject;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Confirm subscription`, accent)}
    <h1 style="font-size:32px;line-height:1.15;margin:0 0 16px 0;color:${accent};font-weight:600;">
      Confirm your subscription.
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:24px 0;">
      ${copy.lead}
    </p>
    ${emailButtonHtml({ href: opts.confirmUrl, label: "Confirm subscription →", accent, margin: "16px 0" })}
    <p style="font-size:11px;line-height:1.6;color:#8C8C96;margin-top:32px;">
      This opens a page with one confirm button · that extra tap is what
      stops an email scanner from subscribing you by accident.
    </p>
    <p style="font-size:11px;line-height:1.6;color:#8C8C96;margin-top:12px;">
      If you didn&apos;t subscribe, ignore this email · no action means you
      won&apos;t receive any further messages. The link expires in 24 hours.
    </p>
    ${emailHairlineHtml()}
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      Galaxy Mind · <a href="${copy.footerUrl}" style="color:${accent};">${copy.footerLabel}</a>
    </p>
  </div>
</body>
</html>`;
  return { subject, html };
}

// ---- Email template ---------------------------------------------

/**
 * Render the Sunday weekly digest. Lighter-weight than an extreme
 * alert: shows the user a 7-day recap with min/avg/max score, the
 * top contributing signal, and a teaser for next week's best window.
 *
 * Includes per-recipient unsubscribe in the footer (digest opt-out
 * is handled via the same flow — unsubscribe removes from the entire
 * audience, not just digest).
 */
export function renderDigestEmail(opts: {
  recipientEmail: string;
  weekRange: { min: number; max: number; avg: number };
  currentScore: number;
  currentTier: string;
  topContributor: string | null;
  bestWindow: string | null;
  daysIncluded: number;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const trendArrow =
    opts.currentScore > opts.weekRange.avg
      ? "↗"
      : opts.currentScore < opts.weekRange.avg
        ? "↘"
        : "→";
  const subject = `Buying Gauge: ${opts.currentScore}/100 ${opts.currentTier} (${trendArrow} ${opts.daysIncluded}d recap)`;
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Weekly digest`, accent)}
    <h1 style="font-size:28px;line-height:1.15;margin:0 0 16px 0;color:#F2EFE9;font-weight:600;">
      The gauge this week.
    </h1>

    ${emailPanelHtml({
      accent,
      label: "Right now",
      padding: "20px",
      margin: "24px 0",
      body: `${emailBigNumberHtml({ value: opts.currentScore, fontSize: "48px", accent, suffix: "/100", suffixSize: "18px" })}
      <div style="font-size:13px;color:${BRIGHT};letter-spacing:0.18em;font-family:${FONT_MONO};text-transform:uppercase;margin-top:8px;font-weight:600;">
        ${opts.currentTier}
      </div>`,
    })}

    <table style="width:100%;border-collapse:collapse;margin:24px 0;">
      <tr>
        <td style="padding:12px 8px;border-bottom:1px solid #26262C;">
          <div style="font-size:10px;letter-spacing:0.22em;font-family:${FONT_MONO};text-transform:uppercase;color:#8C8C96;">${opts.daysIncluded}-day low</div>
          <div style="font-size:22px;color:#F2EFE9;margin-top:4px;font-weight:600;">${opts.weekRange.min}</div>
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #26262C;">
          <div style="font-size:10px;letter-spacing:0.22em;font-family:${FONT_MONO};text-transform:uppercase;color:#8C8C96;">avg</div>
          <div style="font-size:22px;color:#F2EFE9;margin-top:4px;font-weight:600;">${opts.weekRange.avg}</div>
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #26262C;">
          <div style="font-size:10px;letter-spacing:0.22em;font-family:${FONT_MONO};text-transform:uppercase;color:#8C8C96;">${opts.daysIncluded}-day high</div>
          <div style="font-size:22px;color:#F2EFE9;margin-top:4px;font-weight:600;">${opts.weekRange.max}</div>
        </td>
      </tr>
    </table>

    ${
      opts.topContributor
        ? `<p style="font-size:13px;line-height:1.55;color:#A5A096;margin:16px 0;">
        <span style="color:${accent};font-weight:600;">Top contributor:</span> ${esc(opts.topContributor)} is the signal moving the verdict the most this week.
      </p>`
        : ""
    }
    ${
      opts.bestWindow
        ? `<p style="font-size:13px;line-height:1.55;color:#A5A096;margin:16px 0;">
        <span style="color:${accent};font-weight:600;">Week-ahead best window:</span> ${esc(opts.bestWindow)}.
      </p>`
        : ""
    }

    ${emailButtonHtml({ href: "https://galaxymind.space/stack?utm_source=email&utm_medium=digest", label: "View live gauge →", accent, margin: "24px 0 16px 0" })}

    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're receiving this digest because you opted in. Extreme
      threshold alerts arrive separately (typically a few times a
      month, never more than once per day).
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

// Lightweight HTML escape for dynamic strings interpolated into the
// digest template (signal names, best-window labels). All current
// callers pass server-controlled strings, but we escape anyway for
// defense in depth.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Per-source welcome copy (audit-followup 2026-05-21 · parallel to
 * the confirm-email channel-aware fix). Subject + headline + lead +
 * CTA each pivot on the source so /fit subscribers don't get a
 * gauge-themed welcome. Unknown sources fall through to "stack"
 * (legacy behavior).
 *
 * Channels that don't need the live gauge score (everything except
 * "stack") suppress the "RIGHT NOW · X/100 TIER" card entirely · for
 * them the gauge value is irrelevant background. /stack subscribers
 * still get it because the score IS the channel.
 */
type WelcomeCopy = {
  subject: string;
  lead: string;
  ctaUrl: string;
  ctaLabel: string;
  closer: string;
  showGaugeCard: boolean;
};

function welcomeCopyFor(
  source: SubscribeSource,
  currentScore: number,
  currentTier: string,
): WelcomeCopy {
  switch (source) {
    case "fit":
      return {
        subject: "You're in. We'll watch your /fit recommendation.",
        lead:
          "You'll get an email when your recommended portfolio changes meaningfully · " +
          "a sleeve added or removed, or any weight moves at least 5pp. The engine " +
          "re-checks weekly; most weeks it stays stable, so expect zero emails most " +
          "weeks and one when something meaningful shifts.",
        ctaUrl:
          "https://galaxymind.space/fit?utm_source=email&utm_medium=welcome",
        ctaLabel: "Back to /fit →",
        closer:
          "While you wait for the next shift, try the &quot;+1 risk tier&quot; " +
          "comparison or share your scenario with a friend · both are on the /fit page.",
        showGaugeCard: false,
      };
    case "treasuries":
      return {
        subject: "You're in. Treasury cheapness alerts ready.",
        lead:
          "You'll get an email when any tracked treasury (MSTR / MPJPY / XXI / ASST) " +
          "crosses below 1.05× mNAV. One email per crossing · self-deduping. If a " +
          "treasury stays cheap for a week, you get one email when it crosses in, " +
          "not seven.",
        ctaUrl:
          "https://galaxymind.space/treasuries?utm_source=email&utm_medium=welcome",
        ctaLabel: "View treasuries →",
        closer:
          "In the meantime, hover any sparkline on /treasuries to see the 90-day " +
          "mNAV trail, or click a ticker for the SEC-filings drilldown.",
        showGaugeCard: false,
      };
    case "float":
      return {
        subject: "You're in. Float milestone alerts active.",
        lead:
          "You'll get an email when the buyable bitcoin float drops through a 500K " +
          "BTC band (6.5M → 6.0M → 5.5M, etc). Down-crossings only · the scarcity " +
          "moments. Expect roughly one a year given current absorption pace.",
        ctaUrl:
          "https://galaxymind.space/float?utm_source=email&utm_medium=welcome",
        ctaLabel: "View the float →",
        closer:
          "The Reservoir on /float updates live · watch the orange liquid drain " +
          "while you wait for the next milestone.",
        showGaugeCard: false,
      };
    case "vendors":
      return {
        subject: "You're in. New-merchant weekly digest is set.",
        lead:
          "We'll send you a weekly digest of new bitcoin merchants every Sunday. " +
          "Skipped on weeks when nothing new lands · expect zero emails roughly half " +
          "the year (the directory grows in clusters, not constantly).",
        ctaUrl: "https://galaxymind.space/?utm_source=email&utm_medium=welcome",
        ctaLabel: "Browse the directory →",
        closer:
          "Know a vendor we should add? The Submit pill in the header opens a form " +
          "that goes straight to the operator's review queue.",
        showGaugeCard: false,
      };
    case "today":
      return {
        subject: "You're in. Daily briefing alerts are set.",
        lead:
          "You'll get an email on extreme gauge days, float milestones, and the " +
          "weekly digest · so the morning briefing at galaxymind.space/today stays " +
          "honest without opening a tab every day.",
        ctaUrl:
          "https://galaxymind.space/today?utm_source=email&utm_medium=welcome",
        ctaLabel: "Open today's briefing →",
        closer:
          "Bookmark /today as your morning check. Extreme alerts only fire when " +
          "the score actually changes regimes · no spam on multi-day runs.",
        showGaugeCard: true,
      };
    case "seo":
      return {
        subject: `You're in. The Buying Gauge is currently ${currentScore}/100 (${currentTier}).`,
        lead:
          "You'll get an email when the Bitcoin Buying Gauge crosses an extreme " +
          "threshold · score ≥ 80 or ≤ 20. Typically a few times a month, never " +
          "more than once per day.",
        ctaUrl:
          "https://galaxymind.space/today?utm_source=email&utm_medium=welcome",
        ctaLabel: "Open today's briefing →",
        closer:
          "Come back daily at galaxymind.space/today for the four live numbers " +
          "in one place · gauge, float, cheapest treasury, directory pulse.",
        showGaugeCard: true,
      };
    case "hashrate":
      return {
        subject: "You're in. Hashrate availability pings are set.",
        lead:
          "We'll email you when a Galaxy Mind USA machine frees up to rent. " +
          "Availability pings only, not the Sunday digest. Live odds and rent links always at " +
          "galaxymind.space/hashrate.",
        ctaUrl:
          "https://galaxymind.space/hashrate?utm_source=email&utm_medium=welcome",
        ctaLabel: "Open the hashrate desk →",
        closer:
          "Several machines can be rented for the same window when capacity is open. " +
          "Follow @GalaxyMind on X for fleet updates.",
        showGaugeCard: false,
      };
    case "stack":
    default:
      return {
        subject: `You're in. The Buying Gauge is currently ${currentScore}/100 (${currentTier}).`,
        lead:
          "You'll get an email when the Bitcoin Buying Gauge crosses an extreme " +
          "threshold · score ≥ 80 (deeply attractive entry zone) or ≤ 20 (euphoric, " +
          "time to hold). Typically <strong style=\"color:#F2EFE9;font-weight:600;\">a " +
          "few times a month</strong>, never more than once per day, and only when " +
          "the score actually changes regimes (no spam during multi-day extreme runs).",
        ctaUrl:
          "https://galaxymind.space/stack?utm_source=email&utm_medium=welcome",
        ctaLabel: "View live gauge →",
        closer:
          "In the meantime, you can play with the gauge yourself · drag the needle, " +
          "twist the 10 signal sliders, run a 60-second simulation. It's all interactive.",
        showGaugeCard: true,
      };
  }
}

/**
 * Render the welcome email — sent immediately after a subscriber
 * confirms their DOI link. Reinforces the value prop, sets expectations
 * for cadence ("a few times a month"), and (for /stack subscribers
 * only) surfaces today's score so they have a concrete data point to
 * associate with the subscription.
 *
 * Channel-aware (audit-followup 2026-05-21): the legacy version
 * hardcoded the Buying Gauge vocabulary regardless of source · /fit
 * subscribers got "Buying Gauge is currently X/100" subject + a
 * gauge-score card that was completely unrelated to what they
 * actually signed up for. Now picks subject/body/CTA from
 * welcomeCopyFor(source).
 *
 * Includes the per-recipient unsubscribe link so it satisfies CAN-SPAM
 * + RFC 8058 from email #1.
 */
export function renderWelcomeEmail(opts: {
  recipientEmail: string;
  currentScore: number;
  currentTier: string;
  // Defaults to "stack" for legacy callers · /api/subscribe/confirm
  // now threads the source from the DOI pending payload.
  source?: SubscribeSource;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const copy = welcomeCopyFor(
    opts.source ?? "stack",
    opts.currentScore,
    opts.currentTier,
  );
  const subject = copy.subject;
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Subscription confirmed`, accent)}
    <h1 style="font-size:32px;line-height:1.15;margin:0 0 16px 0;color:${accent};font-weight:600;">
      You're in. ⚡
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:24px 0;">
      ${copy.lead}
    </p>
    ${
      copy.showGaugeCard
        ? emailPanelHtml({
            accent,
            label: "Right now",
            padding: "20px",
            margin: "24px 0",
            body: `${emailBigNumberHtml({ value: opts.currentScore, fontSize: "48px", accent, suffix: "/100", suffixSize: "18px" })}
      <div style="font-size:14px;color:${BRIGHT};letter-spacing:0.18em;font-family:${FONT_MONO};text-transform:uppercase;margin-top:8px;font-weight:600;">
        ${opts.currentTier}
      </div>`,
          })
        : ""
    }
    ${emailButtonHtml({ href: copy.ctaUrl, label: copy.ctaLabel, accent, margin: "16px 0" })}
    <!-- Secondary CTA · make threshold customization a prominent one-tap
         action, not just the footer "Edit preferences" link. New
         subscribers who tune their own thresholds early are the ones who
         stay · /prefs manages every alert type (gauge / fit / float /
         treasuries / roundup), so this is universal across sources.
         Bordered, not filled · the design system reserves filled-accent
         for the single primary action (copy.ctaUrl above). -->
    <div style="margin:4px 0 8px 0;">
      <a href="${prefsUrl}" style="display:inline-block;border:1px solid #26262C;color:#A5A096;text-decoration:none;font-weight:600;font-size:12px;letter-spacing:0.16em;font-family:${FONT_MONO};text-transform:uppercase;padding:11px 22px;border-radius:6px;">
        Set your alert thresholds →
      </a>
    </div>
    <p style="font-size:12px;line-height:1.6;color:#A5A096;margin-top:32px;">
      ${copy.closer}
    </p>
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({ prefsUrl, unsubUrl, accent })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/**
 * Build the alert subject line. Pure function so the cron can decide
 * the subject before per-recipient HTML rendering.
 */
export function buildAlertSubject(opts: {
  score: number;
  tierLabel: string;
  subjectFlavor: "molten" | "frozen";
}): string {
  const subjectIcon = opts.subjectFlavor === "frozen" ? "❄" : "🩸";
  return `${subjectIcon} Buying Gauge: ${opts.tierLabel} (${opts.score}/100)`;
}

/**
 * Render the alert email body for a SPECIFIC recipient. The recipient's
 * email is needed to build their unique HMAC unsubscribe token — every
 * outbound email gets a tailored unsub link that maps directly back
 * to that contact, so a one-click "Unsubscribe" in Gmail/Apple Mail
 * removes them from the audience without needing them to log in.
 *
 * Plain HTML, inline styles only — most email clients strip <style>
 * tags and external CSS.
 */
export function renderAlertEmail(opts: {
  score: number;
  tier: string;
  tierLabel: string;
  subjectFlavor: "molten" | "frozen";
  recipientEmail: string;
}): { subject: string; html: string } {
  const isFrozen = opts.subjectFlavor === "frozen";
  const accent = isFrozen ? "#7ec0ff" : "#F7931A";
  const subject = buildAlertSubject(opts);

  // Static alt-link to the live gauge with utm tracking.
  const ctaUrl = "https://galaxymind.space/stack?utm_source=email&utm_medium=alert";

  // Per-recipient one-click unsubscribe URL (HMAC of email — no DB
  // lookup, can't be revoked except by the unsubscribe action itself).
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Bitcoin Buying Gauge · Alert`, accent)}
    <h1 style="font-size:36px;line-height:1.15;margin:0 0 16px 0;color:${accent};font-weight:600;">
      The gauge says ${opts.tierLabel}.
    </h1>
    ${emailBigNumberHtml({ value: opts.score, fontSize: "96px", accent, suffix: "/100", suffixSize: "32px", margin: "16px 0" })}
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:24px 0;">
      ${
        isFrozen
          ? "Euphoric crowd, frothy valuations. Historically the worst moment to deploy fresh capital. Patience is a position."
          : opts.score >= 81
            ? "🩸 Blood in the streets. The gauge has lit up STACK HUGE · exactly the moment Baron Rothschild was talking about. It almost never feels good to deploy here. That's the whole trade."
            : "The score is elevated but not extreme. Fear is building while valuations stay reasonable · the zone that has historically rewarded buying before the mood turns."
      }
    </p>
    ${emailButtonHtml({ href: ctaUrl, label: "View live gauge →", accent, margin: "16px 0" })}
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're receiving this because you subscribed to alerts at galaxymind.space. The gauge only fires when conditions are extreme (typically a few times a month, never more than once per day).
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * Tier-flip alerts · fired by /api/cron/check-thresholds when the
 * Buying Gauge tier changes between cron runs (WARM→HOT, the "dip got
 * real" moment, etc). Separate from the extreme warm/cold alerts: a
 * subscriber can opt into tier-flips and NOT extremes, or both. The
 * cron suppresses tier-flips for recipients who already got an extreme
 * alert in the same run so a HOT→MOLTEN cross never produces two
 * emails per recipient.
 * ===================================================================== */

export function buildTierFlipSubject(opts: {
  fromTierLabel: string;
  toTierLabel: string;
  score: number;
}): string {
  return `Buying Gauge: ${opts.fromTierLabel} → ${opts.toTierLabel} (${opts.score}/100)`;
}

export function renderTierFlipEmail(opts: {
  fromTier: string;
  toTier: string;
  fromTierLabel: string;
  toTierLabel: string;
  score: number;
  // "up" = warming toward MOLTEN (favorable shift); "down" = cooling
  // toward COLD. The cron derives this from the canonical tier
  // ordinal in lib/stack.ts so colour + copy match intent.
  direction: "up" | "down";
  recipientEmail: string;
}): { subject: string; html: string } {
  const accent = opts.direction === "up" ? "#F7931A" : "#7ec0ff";
  const subject = buildTierFlipSubject({
    fromTierLabel: opts.fromTierLabel,
    toTierLabel: opts.toTierLabel,
    score: opts.score,
  });
  const headline =
    opts.direction === "up"
      ? `The gauge moved up to ${opts.toTierLabel}.`
      : `The gauge cooled to ${opts.toTierLabel}.`;
  const blurb =
    opts.direction === "up"
      ? "Conditions just shifted toward buy. Worth a fresh look at the signals."
      : "Conditions cooled. Worth a fresh look at why before assuming the move is over.";
  const ctaUrl =
    "https://galaxymind.space/stack?utm_source=email&utm_medium=tier-flip";
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Bitcoin Buying Gauge · Regime change`, accent)}
    <h1 style="font-size:32px;line-height:1.2;margin:0 0 16px 0;color:${accent};font-weight:600;">
      ${headline}
    </h1>
    <div style="font-size:14px;letter-spacing:0.2em;font-family:${FONT_MONO};text-transform:uppercase;color:#A5A096;margin:24px 0 12px 0;">
      ${opts.fromTierLabel} <span style="color:#8C8C96;">→</span> ${opts.toTierLabel}
    </div>
    ${emailBigNumberHtml({ value: opts.score, fontSize: "72px", accent, suffix: "/100", suffixSize: "26px", margin: "8px 0" })}
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:24px 0;">
      ${blurb}
    </p>
    ${emailButtonHtml({ href: ctaUrl, label: "View live gauge →", accent, margin: "16px 0" })}
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're receiving this because you opted into tier-change alerts at galaxymind.space. These fire only when the gauge crosses between zones, never more than once per day.
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * Treasury mNAV crossing alerts · fired by /api/cron/snapshot-treasuries
 * when any tracked ticker's mNAV crosses INTO cheap (<1.05) or rich
 * (>1.6) territory between consecutive daily snapshots. Self-deduping
 * by construction: the cron compares today vs yesterday, so the alert
 * fires only on the day of the crossing, not every day the ticker
 * remains in that band.
 *
 * Multiple tickers crossing the same day are bundled into one email
 * per direction (e.g. "MSTR + MPJPY crossed cheap"), so a busy day
 * never produces a flood of separate messages per recipient.
 * ===================================================================== */

export type MnavCrossing = {
  ticker: string;
  mNav: number;     // today's value (already across the threshold)
  prevMNav: number; // yesterday's value (still on the other side)
};

export function buildMnavAlertSubject(opts: {
  direction: "cheap" | "rich";
  crossings: MnavCrossing[];
}): string {
  const verb = opts.direction === "cheap" ? "cheap" : "rich";
  const list = opts.crossings.map((c) => c.ticker).join(" + ");
  return `Treasury mNAV: ${list} just went ${verb}`;
}

export function renderMnavAlertEmail(opts: {
  direction: "cheap" | "rich";
  crossings: MnavCrossing[];
  recipientEmail: string;
}): { subject: string; html: string } {
  const isCheap = opts.direction === "cheap";
  // Cheap = bullish accumulation signal (orange), rich = caution (blue
  // muted) to match the /treasuries colour vocabulary.
  const accent = isCheap ? "#F7931A" : "#7ec0ff";
  const subject = buildMnavAlertSubject({
    direction: opts.direction,
    crossings: opts.crossings,
  });
  const headline = isCheap
    ? "A treasury just went cheap."
    : "A treasury just went rich.";
  const blurb = isCheap
    ? "Market cap is now below the value of bitcoin held · historically a strong accumulation signal. Worth a look before the discount closes."
    : "Market cap is now well above the value of bitcoin held · historically a yellow flag for fresh capital. Worth a look before assuming the premium is durable.";
  const ctaUrl =
    "https://galaxymind.space/treasuries?utm_source=email&utm_medium=mnav-alert";
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);

  // One row per crossing · keeps the email scannable when 2+ tickers
  // cross the same day.
  const rows = opts.crossings
    .map(
      (c) => `
    <tr>
      <td style="padding:10px 0;border-top:1px solid #26262C;font-size:14px;font-weight:600;color:#F2EFE9;">
        ${c.ticker}
      </td>
      <td style="padding:10px 0;border-top:1px solid #26262C;font-size:14px;color:#A5A096;text-align:right;">
        ${c.prevMNav.toFixed(2)}× <span style="color:#8C8C96;">→</span>
        <span style="color:${accent};font-weight:600;">${c.mNav.toFixed(2)}×</span>
      </td>
    </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Treasury mNAV · Crossing alert`, accent)}
    <h1 style="font-size:30px;line-height:1.2;margin:0 0 16px 0;color:${accent};font-weight:600;">
      ${headline}
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:20px 0;">
      ${blurb}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 24px 0;">
      ${rows}
    </table>
    ${emailButtonHtml({ href: ctaUrl, label: "View treasuries →", accent, margin: "8px 0" })}
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're receiving this because you opted into treasury mNAV alerts at galaxymind.space. These fire only on the day of a crossing, not every day a ticker stays in that band.
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * Forecast-window "imminent strong window" alerts · fired by
 * /api/cron/check-thresholds when pickBestWindow returns a future
 * cell within 24h whose projected score is in HOT territory. Self-
 * deduping via alerts:forecastWindow:lastSent keyed on the exact
 * cell identity (utcDate+etHour) so the same window can never fire
 * twice. Recipients who already qualify for an extreme alert in the
 * same cron run are excluded to keep the one-email-per-run guarantee.
 * ===================================================================== */

function fmtHoursAway(hoursFromNow: number): string {
  if (hoursFromNow < 1) return "<1h";
  return `${hoursFromNow}h`;
}

export function buildForecastAlertSubject(opts: {
  hoursFromNow: number;
  score: number;
}): string {
  return `Buying Gauge: strong window in ${fmtHoursAway(opts.hoursFromNow)} (projected ${opts.score}/100)`;
}

export function renderForecastAlertEmail(opts: {
  windowLabel: string;       // "Sun 2am–4am ET"
  hoursFromNow: number;      // forecast-cell offset
  score: number;             // projected 0-100
  recipientEmail: string;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const subject = buildForecastAlertSubject({
    hoursFromNow: opts.hoursFromNow,
    score: opts.score,
  });
  const ctaUrl =
    "https://galaxymind.space/stack?utm_source=email&utm_medium=forecast-window";
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Bitcoin Buying Gauge · Imminent window`, accent)}
    <h1 style="font-size:30px;line-height:1.2;margin:0 0 16px 0;color:${accent};font-weight:600;">
      Strong window approaching.
    </h1>
    <div style="font-size:14px;letter-spacing:0.2em;font-family:${FONT_MONO};text-transform:uppercase;color:#A5A096;margin:24px 0 4px 0;">
      ${opts.windowLabel}
    </div>
    ${emailBigNumberHtml({ value: fmtHoursAway(opts.hoursFromNow), fontSize: "64px", accent, suffix: " away", suffixSize: "24px", margin: "8px 0" })}
    <div style="font-size:14px;color:#A5A096;margin:8px 0 24px 0;">
      Projected score <span style="color:${accent};font-weight:600;">${opts.score}/100</span>
    </div>
    <p style="font-size:14px;line-height:1.55;color:#A5A096;margin:0 0 24px 0;">
      The forecast blends today's reading with historical hour-of-day and day-of-week patterns. Not a guarantee · a heads-up that conditions are lining up.
    </p>
    ${emailButtonHtml({ href: ctaUrl, label: "View live forecast →", accent, margin: "0 0 16px 0" })}
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're receiving this because you opted into forecast-window alerts at galaxymind.space. Each unique forecast window fires at most one email.
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * Float milestone alerts · fired by /api/cron/snapshot-float when the
 * buyable bitcoin float drops THROUGH a 500K BTC band (6.5M → 6.0M
 * etc). Down-crossings only · the scarcity narrative is one-directional.
 * Self-deduping by construction: the prev > milestone >= today check
 * only matches on the day-of-crossing.
 * ===================================================================== */

function fmtMillions(n: number): string {
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function buildFloatMilestoneSubject(opts: {
  milestone: number;
  inPlay: number;
}): string {
  return `Bitcoin Float: dropped below ${fmtMillions(opts.milestone)} BTC (now ${fmtMillions(opts.inPlay)})`;
}

export function renderFloatMilestoneEmail(opts: {
  milestone: number;      // the band just crossed, in BTC
  inPlay: number;         // today's value, in BTC
  prevInPlay: number;     // yesterday's value, in BTC
  recipientEmail: string;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const subject = buildFloatMilestoneSubject({
    milestone: opts.milestone,
    inPlay: opts.inPlay,
  });
  const drainedBtc = Math.max(0, opts.prevInPlay - opts.inPlay);
  const ctaUrl =
    "https://galaxymind.space/float?utm_source=email&utm_medium=float-milestone";
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Bitcoin Float · Milestone`, accent)}
    <h1 style="font-size:30px;line-height:1.2;margin:0 0 16px 0;color:${accent};font-weight:600;">
      Float dropped below ${fmtMillions(opts.milestone)} BTC.
    </h1>
    ${emailBigNumberHtml({ value: fmtMillions(opts.inPlay), fontSize: "72px", accent, suffix: " BTC in play", suffixSize: "26px", margin: "12px 0" })}
    <div style="font-size:14px;color:#A5A096;margin:8px 0 24px 0;">
      Yesterday ${fmtMillions(opts.prevInPlay)} · drained ${Math.round(drainedBtc).toLocaleString()} BTC overnight
    </div>
    <p style="font-size:14px;line-height:1.55;color:#A5A096;margin:0 0 24px 0;">
      Less bitcoin is actually available to buy. The reservoir keeps falling · mining drips in, demand drains out faster.
    </p>
    ${emailButtonHtml({ href: ctaUrl, label: "View live float →", accent, margin: "0 0 16px 0" })}
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're receiving this because you opted into float milestone alerts at galaxymind.space. Each 500K BTC band fires at most one email.
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * Hashrate availability · fired by /api/cron/hashrate-available when
 * the number of open Galaxy Mind machines goes up. At most one email
 * per UTC day. Recipients opted in via the /hashrate waitlist
 * (notifyOnHashrateAvailable). The rule lives in
 * lib/hashrate-waitlist so a deploy while boxes are already open
 * cannot blast the list.
 * ===================================================================== */

export function buildHashrateAvailableSubject(openCount: number): string {
  return openCount === 1
    ? "A Galaxy Mind machine is open to rent"
    : `${openCount} Galaxy Mind machines are open to rent`;
}

export function renderHashrateAvailableEmail(opts: {
  openCount: number;
  recipientEmail: string;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const subject = buildHashrateAvailableSubject(opts.openCount);
  const ctaUrl =
    "https://galaxymind.space/hashrate?utm_source=email&utm_medium=hashrate-available";
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);
  const countLine =
    opts.openCount === 1
      ? "One USA machine is open to rent right now."
      : `${opts.openCount} USA machines are open to rent right now.`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`USA fleet · open to rent`, accent)}
    <h1 style="font-size:30px;line-height:1.2;margin:0 0 16px 0;color:${accent};font-weight:600;">
      A machine opened.
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:20px 0;">
      ${countLine} Live odds and the rent link are on the desk. Windows
      do not last, and this email is not a hold.
    </p>
    ${emailButtonHtml({ href: ctaUrl, label: "Open the hashrate desk →", accent, margin: "8px 0 16px 0" })}
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You&apos;re receiving this because you joined the USA fleet waitlist at galaxymind.space/hashrate. At most one email a day, and only when another machine opens.
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * New-vendor weekly digest · fired by /api/cron/new-vendor-digest
 * each Sunday. One email per opted-in subscriber listing vendors
 * added since the last digest (listedAt > lastDigestAt — immutable,
 * unaffected by re-verification). Skips
 * the send entirely when the list is empty · "0 new vendors" is
 * not a notification anyone wants.
 * ===================================================================== */

export type NewVendorDigestEntry = {
  name: string;
  displayHandle: string;
  description: string;
  category: string;
  country?: string;
  slug: string;
};

export function buildNewVendorDigestSubject(count: number): string {
  return count === 1
    ? "Galaxy Mind: 1 new bitcoin merchant added this week"
    : `Galaxy Mind: ${count} new bitcoin merchants added this week`;
}

export function renderNewVendorDigestEmail(opts: {
  vendors: NewVendorDigestEntry[];
  recipientEmail: string;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const subject = buildNewVendorDigestSubject(opts.vendors.length);
  const ctaUrl =
    "https://galaxymind.space/?utm_source=email&utm_medium=new-vendor-digest";
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);

  // One row per vendor, link to its /v/[slug] page. Description
  // truncated at 140 chars to keep the email scannable when 5+
  // vendors land in one week.
  const rows = opts.vendors
    .map((v) => {
      const desc =
        v.description.length > 140
          ? v.description.slice(0, 137).trimEnd() + "..."
          : v.description;
      const flag = v.country ? `${v.country} · ` : "";
      const vendorUrl = `https://galaxymind.space/v/${v.slug}?utm_source=email&utm_medium=new-vendor-digest`;
      return `
    <tr>
      <td style="padding:16px 0;border-top:1px solid #26262C;">
        <a href="${vendorUrl}" style="font-size:16px;font-weight:600;color:${accent};text-decoration:none;">
          ${esc(v.name)}
        </a>
        <span style="font-size:11px;color:#A5A096;letter-spacing:0.1em;font-family:${FONT_MONO};text-transform:uppercase;margin-left:8px;">
          ${esc(flag)}${esc(v.category)}
        </span>
        <div style="font-size:13px;color:#A5A096;margin-top:4px;line-height:1.4;">
          ${esc(desc)}
        </div>
        <div style="font-size:11px;color:#8C8C96;margin-top:6px;font-family:${FONT_MONO};">
          ${esc(v.displayHandle)}
        </div>
      </td>
    </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Directory digest`, accent)}
    <h1 style="font-size:28px;line-height:1.2;margin:0 0 8px 0;color:${accent};font-weight:600;">
      ${opts.vendors.length === 1
        ? "1 new merchant this week."
        : `${opts.vendors.length} new merchants this week.`}
    </h1>
    <p style="font-size:14px;line-height:1.55;color:#A5A096;margin:8px 0 16px 0;">
      The circular economy keeps growing. Spend a sat somewhere new.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 24px 0;">
      ${rows}
    </table>
    ${emailButtonHtml({ href: ctaUrl, label: "Browse the directory →", accent, margin: "0 0 16px 0" })}
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    ${emailFooterHtml({
      prefsUrl,
      unsubUrl,
      accent,
      extra: `<p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're receiving this because you opted into the new-vendors weekly digest at galaxymind.space. Sent at most once per week, skipped when nothing new landed.
    </p>`,
    })}
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * "You're live" notification · fires ONCE per submitted vendor when
 * they first land in a new-vendor digest window. Independent of the
 * subscriber audience · the recipient is the submitter who opted in
 * at /submit, not a directory alert subscriber. No unsubscribe link
 * because there's nothing to unsubscribe FROM · this is a single
 * transactional email tied to one submission.
 * ===================================================================== */

export function buildVendorLiveSubject(vendorName: string): string {
  // eslint-disable-next-line no-control-regex
  const name = vendorName.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 100);
  return `${name} is live on Galaxy Mind`;
}

/**
 * Escape for rendering markup AS VISIBLE TEXT inside an email <pre>.
 * The badge snippet is fully derived from vendorSlug (lowercase
 * alphanumeric + hyphens), so this is not an injection defense — it is
 * what makes the `<a>`/`<img>` render as characters the merchant can
 * copy instead of being parsed as tags and disappearing.
 */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderVendorLiveEmail(opts: {
  vendorName: string;
  vendorSlug: string;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const subject = buildVendorLiveSubject(opts.vendorName);
  const vendorUrl = `https://galaxymind.space/v/${opts.vendorSlug}?utm_source=email&utm_medium=vendor-live`;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`You're live`, accent)}
    <h1 style="font-size:30px;line-height:1.2;margin:0 0 16px 0;color:${accent};font-weight:600;">
      ${esc(opts.vendorName)} is in the directory.
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:20px 0;">
      Your submission was verified and added. People looking for merchants who accept bitcoin can find you now. Your dedicated page is below · share it with your customers so they know where to send people.
    </p>
    ${emailButtonHtml({ href: vendorUrl, label: "View your page →", accent, margin: "8px 0 16px 0" })}
    <p style="font-size:13px;line-height:1.55;color:#A5A096;margin:24px 0;">
      A vendor RT is the single biggest organic-growth lever the directory has · one post primes your audience to find you here when they need to spend bitcoin.
    </p>
    ${emailHairlineHtml()}
    <p style="font-size:15px;line-height:1.55;color:#F2EFE9;margin:20px 0 8px 0;font-weight:600;">
      Show shoppers you accept Bitcoin
    </p>
    <p style="font-size:13px;line-height:1.55;color:#A5A096;margin:0 0 12px 0;">
      Paste this in your footer or next to checkout, or grab it any time at <a href="https://galaxymind.space/badge" style="color:${accent};">galaxymind.space/badge</a>. It renders a live “${VENDOR_BADGE.label} · ${VENDOR_BADGE.live}” badge. A customer who clicks it lands on your listing and can confirm a person here checked that you take bitcoin. It flips to “${VENDOR_BADGE.stale}” on its own if a human hasn't confirmed it in ${STALE_THRESHOLD_DAYS} days, so it can never claim something stale on your behalf.
    </p>
    <ul style="font-size:13px;line-height:1.55;color:#A5A096;margin:0 0 12px 0;padding-left:20px;">
      ${BADGE_BENEFITS.map((line) => `<li style="margin:0 0 6px 0;">${esc(line)}</li>`).join("")}
    </ul>
    <!-- Rendered as TEXT, not as an <img> preview. Most mail clients
         block remote images by default, so an image-first treatment
         arrives as an empty box — and the thing the merchant actually
         needs is the markup they can copy, not a picture of the badge. -->
    <pre style="font-size:11px;line-height:1.5;color:#7ec0ff;background:#1C1C21;border-radius:8px;padding:12px;margin:0 0 8px 0;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${escapeHtmlText(
      vendorBadgeSnippet(opts.vendorSlug),
    )}</pre>
    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      One-time notification for your submission. Not financial advice. Built by <a href="https://x.com/GalaxyMind" style="color:${accent};">@GalaxyMind</a>.
    </p>
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * Submission-rejected notice · the counterpart to the "you're live"
 * email above, sent (at the operator's discretion, per rejection)
 * from /api/admin/notify-submitter when the review CLI rejects a
 * submission whose submitter left a notify address. Same one-shot
 * transactional posture · no unsub footer.
 *
 * BOTH interpolated values here are untrusted at render time:
 * vendorName is submitter-supplied (only control/bidi-stripped at
 * submit) and reason is operator free-text. Escape them.
 *
 * 2026-08 audit correction · this comment used to say renderVendorLive
 * Email's vendorName "comes from the operator-approved vendors.ts",
 * implying it needed no escaping. That is true of the cron caller but
 * NOT of /api/admin/notify-submitter, which takes `name` straight from
 * a POST body (admin-authed, so not a vuln — but the stated reason for
 * skipping the escape was wrong). Both templates now escape.
 * ===================================================================== */

function escapeEmailText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSubmissionRejectedSubject(vendorName: string): string {
  return `Your Galaxy Mind submission · ${vendorName}`;
}

export function renderSubmissionRejectedEmail(opts: {
  vendorName: string;
  reason: string;
  /**
   * Submitter-facing "what to fix" line from lib/submission-outcomes.
   * Optional and nullable on purpose: some outcomes have no path back,
   * and inventing one invites a resubmission that will be declined
   * again. When absent the email simply omits the block.
   */
  remedy?: string | null;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  // Control-char strip on the subject line (defense-in-depth against
  // CRLF header injection · same layering as notifyOnSubmission in
  // /api/submit-vendor), then HTML-escape wherever it lands in markup.
  // eslint-disable-next-line no-control-regex
  const subject = buildSubmissionRejectedSubject(
    opts.vendorName.replace(/[\x00-\x1F\x7F]/g, ""),
  );
  const safeName = escapeEmailText(opts.vendorName);
  const safeReason = escapeEmailText(opts.reason);
  const safeRemedy = opts.remedy ? escapeEmailText(opts.remedy) : "";
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeEmailText(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Submission update`, accent)}
    <h1 style="font-size:26px;line-height:1.25;margin:0 0 16px 0;color:#F2EFE9;font-weight:600;">
      We couldn&apos;t add ${safeName} this time.
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#A5A096;margin:20px 0;">
      Thanks for submitting to the directory · a human reviewed your
      entry and couldn&apos;t verify it as-is. Here&apos;s why:
    </p>
    ${emailPanelHtml({
      accent,
      label: "Reviewer note",
      body: `<p style="font-size:14px;line-height:1.6;color:${BRIGHT};margin:0;">${safeReason}</p>`,
    })}
    ${
      safeRemedy
        ? emailPanelHtml({
            accent,
            label: "What to fix",
            body: `<p style="font-size:14px;line-height:1.6;color:${BRIGHT};margin:0;">${safeRemedy}</p>`,
          })
        : ""
    }
    <p style="font-size:14px;line-height:1.55;color:#A5A096;margin:20px 0;">
      ${
        safeRemedy
          ? "Once that&apos;s sorted, resubmit any time · the form takes about a minute."
          : "If anything above looks wrong to you, reply and tell us · we do get it wrong sometimes."
      }
      Questions? DM <a href="https://x.com/GalaxyMind" style="color:${accent};">@GalaxyMind</a> on X or message us on Nostr.
    </p>
    ${safeRemedy ? emailButtonHtml({ href: "https://galaxymind.space/submit?utm_source=email&utm_medium=submission-rejected", label: "Resubmit →", accent, margin: "8px 0 16px 0" }) : ""}
    ${emailHairlineHtml()}
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      One-time notification for your submission. Not financial advice. Built by <a href="https://x.com/GalaxyMind" style="color:${accent};">@GalaxyMind</a>.
    </p>
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * /fit allocation-change alert · fires from the weekly Sunday cron
 * when the engine's recommendation for a subscriber's (horizon,
 * tolerance, account) tuple has shifted enough to be worth knowing
 * about (sleeve added/removed, or any sleeve weight delta >= 5pp ·
 * gate lives in lib/fit-alert.ts).
 *
 * Email body shows the prev → next allocation side-by-side, with the
 * specific deltas called out so the subscriber can act without
 * re-running the tool. The CTA returns them to /fit with their inputs
 * pre-filled (?h=&t=&a=) so the live page mirrors what the email
 * described.
 * ===================================================================== */

const TIER_LABELS_BY_NUM: Record<Tolerance, string> = {
  1: "Minimal",
  2: "Low",
  3: "Moderate",
  4: "High",
  5: "Maxi",
  6: "Ludicrous",
};

const ACCOUNT_LABELS: Record<AccountType, string> = {
  taxable: "Taxable",
  traditional: "Traditional IRA",
  roth: "Roth IRA",
};

export function buildFitChangeSubject(opts: {
  h: number;
  t: Tolerance;
  a: AccountType;
  changeKind: "composition" | "weight";
}): string {
  const tier = TIER_LABELS_BY_NUM[opts.t];
  const lead =
    opts.changeKind === "composition"
      ? "Your /fit recommendation changed"
      : "Your /fit weights shifted";
  return `${lead} (${tier} · ${opts.h}y · ${ACCOUNT_LABELS[opts.a]})`;
}

/**
 * Format the diff as scannable bullet rows: added (+), removed (−),
 * shifted (Δpp with arrow). Kept compact since the email already shows
 * the full prev → next side-by-side; this is the "what to actually look
 * at" callout.
 */
function fitDiffSummaryRows(diff: Extract<DiffResult, { changed: true }>): string {
  const lines: string[] = [];
  for (const s of diff.added) {
    lines.push(
      `<div style="font-family:${FONT_MONO};font-size:13px;color:#4ADE80;margin:4px 0;">+ ${esc(s.ticker)} <span style="color:#A5A096;">added at ${s.weight}%</span></div>`,
    );
  }
  for (const s of diff.removed) {
    lines.push(
      `<div style="font-family:${FONT_MONO};font-size:13px;color:#FB923C;margin:4px 0;">− ${esc(s.ticker)} <span style="color:#A5A096;">removed (was ${s.weight}%)</span></div>`,
    );
  }
  for (const sh of diff.shifted) {
    const arrow = sh.deltaPp > 0 ? "↑" : "↓";
    const color = sh.deltaPp > 0 ? "#4ADE80" : "#FB923C";
    const sign = sh.deltaPp > 0 ? "+" : "";
    lines.push(
      `<div style="font-family:${FONT_MONO};font-size:13px;color:${color};margin:4px 0;">${arrow} ${esc(sh.ticker)} <span style="color:#A5A096;">${sh.prevWeight}% → ${sh.nextWeight}% (${sign}${sh.deltaPp}pp)</span></div>`,
    );
  }
  return lines.join("");
}

/**
 * Render the side-by-side allocation table. Tickers in `next` that
 * weren't in `prev` get a + chip; tickers in `prev` that aren't in
 * `next` show "—" in the next column. Order: union of tickers in
 * stable iteration order (next-first, then prev-only).
 */
function fitSideBySideTable(
  prev: SleeveSnapshot[],
  next: SleeveSnapshot[],
  accent: string,
): string {
  const prevByTicker = new Map(prev.map((s) => [s.ticker, s.weight]));
  const nextByTicker = new Map(next.map((s) => [s.ticker, s.weight]));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const s of next) {
    if (!seen.has(s.ticker)) {
      seen.add(s.ticker);
      ordered.push(s.ticker);
    }
  }
  for (const s of prev) {
    if (!seen.has(s.ticker)) {
      seen.add(s.ticker);
      ordered.push(s.ticker);
    }
  }
  const rows = ordered
    .map((ticker) => {
      const p = prevByTicker.get(ticker);
      const n = nextByTicker.get(ticker);
      const prevCell =
        p == null
          ? `<span style="color:#8C8C96;">·</span>`
          : `${p}%`;
      const nextCell =
        n == null
          ? `<span style="color:#8C8C96;">·</span>`
          : `<span style="color:${accent};font-weight:600;">${n}%</span>`;
      return `
      <tr>
        <td style="padding:8px 12px;border-top:1px solid #26262C;font-family:${FONT_MONO};font-size:13px;color:#F2EFE9;">${esc(ticker)}</td>
        <td style="padding:8px 12px;border-top:1px solid #26262C;font-family:${FONT_MONO};font-size:13px;color:#A5A096;text-align:right;">${prevCell}</td>
        <td style="padding:8px 12px;border-top:1px solid #26262C;font-family:${FONT_MONO};font-size:13px;text-align:right;">${nextCell}</td>
      </tr>`;
    })
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 16px 0;border:1px solid #26262C;border-radius:8px;border-collapse:separate;">
      <thead>
        <tr>
          <th style="padding:10px 12px;text-align:left;font-size:10px;letter-spacing:0.2em;font-family:${FONT_MONO};text-transform:uppercase;color:#A5A096;font-weight:600;">Sleeve</th>
          <th style="padding:10px 12px;text-align:right;font-size:10px;letter-spacing:0.2em;font-family:${FONT_MONO};text-transform:uppercase;color:#A5A096;font-weight:600;">Before</th>
          <th style="padding:10px 12px;text-align:right;font-size:10px;letter-spacing:0.2em;font-family:${FONT_MONO};text-transform:uppercase;color:#A5A096;font-weight:600;">Now</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderFitChangeEmail(opts: {
  recipientEmail: string;
  h: number;
  t: Tolerance;
  a: AccountType;
  diff: Extract<DiffResult, { changed: true }>;
  prev: SleeveSnapshot[];
  next: SleeveSnapshot[];
  lastSentAt: number | null;
}): { subject: string; html: string } {
  const accent = "#F7931A";
  const subject = buildFitChangeSubject({
    h: opts.h,
    t: opts.t,
    a: opts.a,
    changeKind: opts.diff.kind,
  });
  const tier = TIER_LABELS_BY_NUM[opts.t];
  const account = ACCOUNT_LABELS[opts.a];
  const unsubUrl = buildUnsubscribeUrl(opts.recipientEmail);
  const prefsUrl = buildPrefsUrl(opts.recipientEmail);
  // Pre-fill the recipient's tuple so the CTA opens /fit on exactly
  // the configuration the email is about — no re-entering inputs.
  const ctaUrl =
    `https://galaxymind.space/fit?h=${opts.h}&t=${opts.t}&a=${opts.a}` +
    `&utm_source=email&utm_medium=fit-change`;

  const sinceLine = opts.lastSentAt
    ? `Since the last update on ${new Date(opts.lastSentAt).toISOString().slice(0, 10)}.`
    : `Since you opted in for change alerts.`;

  const lead =
    opts.diff.kind === "composition"
      ? "A sleeve was added or removed."
      : "Sleeve weights shifted past the 5pp threshold.";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`/fit recommendation change`, accent)}
    <h1 style="font-size:28px;line-height:1.2;margin:0 0 12px 0;color:${accent};font-weight:600;">
      ${lead}
    </h1>
    <p style="font-size:14px;line-height:1.55;color:#A5A096;margin:0 0 4px 0;">
      ${esc(tier)} tolerance · ${opts.h}-year horizon · ${esc(account)}
    </p>
    <p style="font-size:12px;line-height:1.55;color:#8C8C96;margin:0 0 20px 0;">
      ${sinceLine}
    </p>

    ${emailPanelHtml({
      accent,
      label: "What changed",
      padding: "16px 18px",
      margin: "0 0 20px 0",
      body: fitDiffSummaryRows(opts.diff),
    })}

    <div style="font-size:10px;font-family:${FONT_MONO};letter-spacing:0.28em;text-transform:uppercase;color:#A5A096;margin:0 0 6px 0;">
      Full allocation
    </div>
    ${fitSideBySideTable(opts.prev, opts.next, accent)}

    ${emailButtonHtml({ href: ctaUrl, label: "View live recommendation →", accent, margin: "8px 0 16px 0" })}

    <p style="font-size:12px;line-height:1.55;color:#A5A096;margin:20px 0 0 0;">
      The engine re-checks weekly. You'll get an email only when a sleeve is added/removed, or any weight moves at least 5 percentage points · everything smaller is treated as engine jitter.
    </p>

    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You opted into allocation-change alerts at galaxymind.space/fit. Not financial advice. ·
      <a href="${prefsUrl}" style="color:#A5A096;text-decoration:underline;">Edit preferences</a> ·
      <a href="${unsubUrl}" style="color:#A5A096;text-decoration:underline;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
  return { subject, html };
}

/* =====================================================================
 * Monthly market roundup · the only DEFAULT-ON channel. Sent on the
 * first Sunday of each month. Operator-requested as a regular touch-
 * point so subscribers stay engaged between extreme-alert events
 * (which can be weeks apart in calm markets).
 *
 * Content philosophy: rich enough to be genuinely useful (multiple
 * data points across all four surfaces) but not so dense that it
 * reads as a newsletter — kept to four scannable sections + the
 * Saylor footer voice. The aim is "the most-useful 60 seconds of
 * monthly Bitcoin context", not "industry digest."
 *
 * Inputs are computed by the cron from KV history + the current
 * snapshot; this renderer just formats them. Best-effort
 * graceful-degradation: any section whose input data is null
 * silently disappears (e.g., empty stack:history early in deploy →
 * no 30-day range line; no new vendors this month → no vendor
 * section). The header + Saylor footer are always present.
 * ===================================================================== */

export type MonthlyRoundupTreasuryMover = {
  ticker: string;
  fromMnav: number;
  toMnav: number;
  deltaPct: number; // signed; e.g. -21 means mNAV fell 21%
};

export type MonthlyRoundupVendor = {
  name: string;
  displayHandle: string;
  category: string;
  slug: string;
  country?: string;
};

export type MonthlyRoundupInput = {
  recipientEmail: string;
  monthLabel: string;   // "May 2026"
  gauge: {
    score: number;
    tier: string;       // "HOT" / "WARM" / etc
    range30d: { min: number; max: number; avg: number } | null;
    scoreAMonthAgo: number | null;
  };
  treasuries: {
    cheapest: { ticker: string; mNAV: number } | null;
    biggestMover: MonthlyRoundupTreasuryMover | null;
  };
  newVendors: {
    count: number;
    top: MonthlyRoundupVendor[]; // up to 3, ordered most-recent first
  };
};

export function buildMonthlyRoundupSubject(input: MonthlyRoundupInput): string {
  // Lead with the gauge score · it's the single most-recognizable
  // number across the subscriber base. Month context is the brand
  // through-line.
  return `Galaxy Mind monthly · gauge ${input.gauge.score}/100 ${input.gauge.tier} · ${input.monthLabel}`;
}

export function renderMonthlyRoundupEmail(
  input: MonthlyRoundupInput,
): { subject: string; html: string } {
  const accent = "#F7931A";
  const subject = buildMonthlyRoundupSubject(input);
  const unsubUrl = buildUnsubscribeUrl(input.recipientEmail);
  const prefsUrl = buildPrefsUrl(input.recipientEmail);

  // ---- Section: Gauge --------------------------------------------
  const monthDeltaLine = (() => {
    const a = input.gauge.scoreAMonthAgo;
    if (a == null) return "";
    const delta = input.gauge.score - a;
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    const sign = delta > 0 ? "+" : "";
    return `<div style="font-size:12px;color:#8C8C96;margin-top:4px;">${arrow} ${sign}${delta} pts from ${a} a month ago</div>`;
  })();
  const rangeLine = input.gauge.range30d
    ? `<div style="font-size:12px;color:#A5A096;margin-top:8px;font-family:${FONT_MONO};">30-day range · low ${input.gauge.range30d.min} / avg ${input.gauge.range30d.avg} / high ${input.gauge.range30d.max}</div>`
    : "";
  const gaugeSection = emailPanelHtml({
    accent,
    label: "Bitcoin Buying Gauge",
    padding: "18px 20px",
    margin: "0 0 20px 0",
    body: `${emailBigNumberHtml({
      value: input.gauge.score,
      fontSize: "48px",
      accent,
      suffix: "/100",
      suffixSize: "18px",
      trailing: `<span style="font-size:14px;color:${BRIGHT};letter-spacing:0.18em;font-family:${FONT_MONO};text-transform:uppercase;margin-left:12px;font-weight:600;">${esc(input.gauge.tier)}</span>`,
    })}
      ${monthDeltaLine}
      ${rangeLine}
      <a href="https://galaxymind.space/stack?utm_source=email&utm_medium=monthly-roundup" style="display:inline-block;margin-top:12px;font-size:11px;letter-spacing:0.18em;font-family:${FONT_MONO};text-transform:uppercase;color:${accent};text-decoration:none;font-weight:600;">
        Open the gauge →
      </a>`,
  });

  // ---- Section: Treasuries ---------------------------------------
  const treasuriesSection = (() => {
    if (!input.treasuries.cheapest && !input.treasuries.biggestMover) return "";
    const cheapestLine = input.treasuries.cheapest
      ? `<div style="font-size:13px;color:#F2EFE9;margin:6px 0;font-family:${FONT_MONO};">Cheapest now: <span style="color:${accent};font-weight:600;">${esc(input.treasuries.cheapest.ticker)}</span> at ${input.treasuries.cheapest.mNAV.toFixed(2)}× mNAV</div>`
      : "";
    const moverLine = input.treasuries.biggestMover
      ? (() => {
          const m = input.treasuries.biggestMover!;
          const color = m.deltaPct < 0 ? "#4ADE80" : "#FB923C";
          const sign = m.deltaPct > 0 ? "+" : "";
          return `<div style="font-size:13px;color:#F2EFE9;margin:6px 0;font-family:${FONT_MONO};">Biggest mover: <span style="color:${color};font-weight:600;">${esc(m.ticker)}</span> ${m.fromMnav.toFixed(2)}× → ${m.toMnav.toFixed(2)}× (${sign}${Math.round(m.deltaPct)}%)</div>`;
        })()
      : "";
    return emailPanelHtml({
      accent,
      label: "Treasuries",
      padding: "18px 20px",
      margin: "0 0 20px 0",
      body: `${cheapestLine}
      ${moverLine}
      <a href="https://galaxymind.space/treasuries?utm_source=email&utm_medium=monthly-roundup" style="display:inline-block;margin-top:8px;font-size:11px;letter-spacing:0.18em;font-family:${FONT_MONO};text-transform:uppercase;color:${accent};text-decoration:none;font-weight:600;">
        Full head-to-head →
      </a>`,
    });
  })();

  // ---- Section: New vendors --------------------------------------
  const vendorsSection = (() => {
    if (input.newVendors.count === 0) return "";
    const rows = input.newVendors.top
      .map((v) => {
        const flag = v.country ? `${v.country} · ` : "";
        const url = `https://galaxymind.space/v/${v.slug}?utm_source=email&utm_medium=monthly-roundup`;
        return `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #26262C;">
            <a href="${url}" style="font-size:15px;font-weight:600;color:${accent};text-decoration:none;">${esc(v.name)}</a>
            <span style="font-size:11px;color:#A5A096;letter-spacing:0.1em;font-family:${FONT_MONO};text-transform:uppercase;margin-left:8px;">
              ${esc(flag)}${esc(v.category)}
            </span>
            <div style="font-size:11px;color:#8C8C96;margin-top:2px;font-family:${FONT_MONO};">
              ${esc(v.displayHandle)}
            </div>
          </td>
        </tr>`;
      })
      .join("");
    const more =
      input.newVendors.count > input.newVendors.top.length
        ? `<div style="font-size:12px;color:#A5A096;margin-top:8px;">+ ${input.newVendors.count - input.newVendors.top.length} more this month</div>`
        : "";
    return emailPanelHtml({
      accent,
      label:
        input.newVendors.count === 1
          ? "1 new merchant this month"
          : `${input.newVendors.count} new merchants this month`,
      padding: "18px 20px",
      margin: "0 0 20px 0",
      body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${rows}</table>
      ${more}
      <a href="https://galaxymind.space/?utm_source=email&utm_medium=monthly-roundup" style="display:inline-block;margin-top:10px;font-size:11px;letter-spacing:0.18em;font-family:${FONT_MONO};text-transform:uppercase;color:${accent};text-decoration:none;font-weight:600;">
        Browse the directory →
      </a>`,
    });
  })();

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#12110F;font-family:${FONT_SANS};color:#F2EFE9;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    ${emailMastheadHtml(`Monthly dispatch · ${esc(input.monthLabel)}`, accent)}
    <h1 style="font-size:28px;line-height:1.2;margin:0 0 8px 0;color:${accent};font-weight:600;">
      The most-useful 60 seconds of Bitcoin this month.
    </h1>
    <p style="font-size:13px;line-height:1.55;color:#A5A096;margin:8px 0 20px 0;">
      Across the gauge, the treasuries, and the directory · what changed and what to look at next.
    </p>

    ${gaugeSection}
    ${treasuriesSection}
    ${vendorsSection}

    ${saylorFooterHtml(accent)}
    ${emailHairlineHtml()}
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      You're getting this because you signed up for Galaxy Mind alerts · the monthly roundup is on by default to keep you connected to the data between extreme-alert events. Toggle it off anytime via Edit preferences. ·
      <a href="${prefsUrl}" style="color:#A5A096;text-decoration:underline;">Edit preferences</a> ·
      <a href="${unsubUrl}" style="color:#A5A096;text-decoration:underline;">Unsubscribe</a>
    </p>
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      Not financial advice. Built by <a href="https://x.com/GalaxyMind" style="color:${accent};">@GalaxyMind</a>.
    </p>
  </div>
</body>
</html>`;
  return { subject, html };
}

/**
 * Vendor-review digest. SKIP-ON-EMPTY is the caller's job and is not
 * optional: a nightly "0 changes" mail is how an alert channel becomes
 * one the operator stops opening. Same rule as new-vendor-digest.
 */
export function renderVendorReviewEmail(entries: QueueEntry[]): {
  subject: string;
  html: string;
} {
  const high = entries.filter((e) => e.priority === "high").length;
  const subject =
    high > 0
      ? `[Galaxy Mind] ${entries.length} vendor${entries.length === 1 ? "" : "s"} need review (${high} urgent)`
      : `[Galaxy Mind] ${entries.length} vendor${entries.length === 1 ? "" : "s"} need review`;
  const rows = entries
    .map(
      (e) =>
        `<tr><td style="padding:6px 10px;font-family:monospace">${esc(e.handle)}</td>` +
        `<td style="padding:6px 10px">${e.priority === "high" ? "<strong>urgent</strong>" : "normal"}</td>` +
        `<td style="padding:6px 10px">${esc(e.reason)}</td></tr>`,
    )
    .join("");
  const html = `<p>These vendors changed since last night's check. Nothing has been altered in the directory: <code>verifiedAt</code> only moves when you confirm.</p>
<table style="border-collapse:collapse">${rows}</table>
<p>The handles, priorities and reasons above are everything flagged in tonight's run, so this email stands on its own even if the queue has changed by the time you read it. To work through them, run <code>npx tsx scripts/reverify-vendors.ts --queue</code>, which reads the live queue in KV and may show fewer entries than listed here if something has already resolved.</p>`;
  return { subject, html };
}
