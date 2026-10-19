// Trusted client-IP extraction · centralizes the "which header do I
// actually trust?" decision and sanitizes the result so it's safe to
// use as a KV key, log line component, or rate-limit identifier.
//
// AUDIT BACKGROUND (2026-05-14):
// Three rate-limited routes (/api/submit-vendor, /api/enrich-handle,
// /api/subscribe) had each rolled their own clientIp() helper, all
// using the same fragile pattern:
//
//   const fwd = headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
//   return fwd ? fwd.split(",")[0].trim() : "unknown";
//
// Two real risks with that pattern:
//
// 1. SPOOFING: Vercel does NOT strip a user-supplied X-Forwarded-For
//    header on incoming requests · it APPENDS the connecting client's
//    IP to whatever the client sent. So `split(",")[0]` returns the
//    ATTACKER-CONTROLLED first value, not Vercel's trusted append.
//    An attacker setting `X-Forwarded-For: 1.2.3.4` on every request
//    bypasses every IP rate-limit by appearing as "1.2.3.4" each time.
//
// 2. KV-KEY INJECTION: the result is interpolated into a KV key like
//    `submit-vendor:rl:${ip}`. An attacker controlling the IP value
//    via spoofed XFF could craft a string that, after `split(",")[0]`,
//    matches another IP's rate-limit slot · DoS-ing that IP's limit.
//    Or with characters like `:` they could deliberately collide with
//    other key namespaces.
//
// THE FIRST FIX (SUPERSEDED · kept as history, see re-audit below):
//   getClientIp(req) preferred x-real-ip (believing Vercel set it
//   server-side and clients could not override), falling back to the LAST value of
//   x-forwarded-for (the Vercel-appended one, not the attacker-controlled
//   first value), and validates the result against an IPv4/IPv6
//   character set before returning. Anything that doesn't look like
//   a real IP becomes "unknown" so a rate-limiter still fires (just
//   more coarsely · all unknown-IP traffic shares a single bucket).
//
// 2026-05 ADVERSARIAL RE-AUDIT — the "prefer x-real-ip" fix above was
// WRONG and only MOVED the spoof. On Vercel's Node serverless runtime,
// BOTH `x-real-ip` AND `x-forwarded-for` are client-PRESENTABLE: Vercel
// does NOT strip an inbound client-supplied `x-real-ip`, so an attacker
// sending `X-Real-IP: 1.2.3.<rotating>` still gets a fresh rate-limit
// bucket every request → universal rate-limit bypass (re-enabling the
// queue-flood / SSRF-amplification / DOI-email-bomb vectors).
//
// THE ONLY non-client-spoofable client-IP source on Vercel is the
// platform-reserved `x-vercel-forwarded-for` header: Vercel STRIPS all
// inbound `x-vercel-*` headers at the edge and re-sets this one from
// the verified connecting socket. Clients cannot forge it. We use it
// as the authoritative source and treat x-forwarded-for / x-real-ip
// as untrusted best-effort fallbacks ONLY for non-Vercel/local-dev
// (where no attacker model applies). Still character-validated so the
// result is always safe as a KV-key / log component.
//
// REFERENCES:
//   · Vercel reserved `x-vercel-*` request headers are stripped from
//     inbound requests and re-set by the platform.
//   · Audit findings C-2/C-3 (2026-05-14) + adversarial re-audit
//     (2026-05) "Finding 1: x-real-ip spoofable → rate-limit bypass".

/**
 * Returns true iff the string contains only characters valid in an
 * IPv4 dotted-quad or IPv6 hex-colon representation. This is a
 * permissive shape check, not a structural validity check · we don't
 * verify the IP is a valid address, just that it can't carry a KV
 * key delimiter, log-injection newline, or shell metacharacter.
 *
 * Length cap of 45 covers the longest possible IPv6 string (45 chars
 * for full-form IPv4-mapped IPv6, e.g. "0000:0000:...:255.255.255.255").
 */
function isPlausibleIp(s: string): boolean {
  return s.length > 0 && s.length <= 45 && /^[0-9a-fA-F:.]+$/.test(s);
}

/**
 * Extract the connecting-client IP from the request, preferring
 * Vercel's trusted `x-real-ip` header and falling back defensively
 * to the LAST value of `x-forwarded-for` (the Vercel-appended one).
 *
 * Returns the literal string `"unknown"` when neither header yields
 * a plausible IP · callers should still proceed (treating unknown
 * as a single shared rate-limit bucket) rather than blocking the
 * request, since plenty of legitimate traffic could land there
 * during proxy / CDN reconfiguration.
 *
 * The returned string is safe to interpolate into KV keys, log
 * lines, and JSON responses · the character-set check ensures no
 * injection-class characters survive.
 */
export function getClientIp(req: Request | { headers: Headers }): string {
  const headers = "headers" in req ? req.headers : (req as Request).headers;

  // AUTHORITATIVE: x-vercel-forwarded-for. Vercel strips all inbound
  // `x-vercel-*` headers at the edge and re-sets this from the verified
  // connecting socket — a client CANNOT forge it. This is the only
  // trustworthy client-IP source for security decisions (rate-limit
  // keying). It may contain a comma chain; Vercel's verified IP is the
  // FIRST entry here (it's the platform's own header, not a passthrough
  // of the client chain).
  const vercelFwd = headers.get("x-vercel-forwarded-for");
  if (vercelFwd) {
    const first = vercelFwd.split(",")[0]?.trim() ?? "";
    if (isPlausibleIp(first)) return first;
  }

  // UNTRUSTED FALLBACKS — only meaningful off-Vercel (local dev, a
  // different host). On Vercel in production x-vercel-forwarded-for is
  // always present, so these branches don't execute for real traffic
  // and the spoofable-header attack surface is closed. Kept so local
  // `next dev` still produces a usable (non-security-critical) bucket.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim() ?? "";
    if (isPlausibleIp(first)) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (isPlausibleIp(trimmed)) return trimmed;
  }

  return "unknown";
}
