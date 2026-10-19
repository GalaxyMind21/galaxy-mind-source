// Cloudflare Turnstile server-side verification.
//
// Turnstile is Cloudflare's privacy-respecting captcha alternative —
// no behavioural fingerprinting, no third-party tracking, drop-in for
// reCAPTCHA. Required env vars:
//
//   TURNSTILE_SITE_KEY    — public site key, exposed to the browser
//                            via NEXT_PUBLIC_TURNSTILE_SITE_KEY
//                            (set BOTH in Vercel; the public one is
//                            what the form widget uses)
//   TURNSTILE_SECRET_KEY  — server-side secret, used to verify tokens
//
// Without TURNSTILE_SECRET_KEY, isTurnstileConfigured() returns false
// and verifyTurnstileToken() returns "skip" — the subscribe route then
// proceeds without a captcha check (graceful degradation; same pattern
// as KV).

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export type TurnstileVerifyResult =
  | { ok: true; kind: "verified" }
  | { ok: true; kind: "skip" }       // not configured, allowed
  | { ok: false; reason: string };

/**
 * Verify a Turnstile token from the browser. Pass the token plus the
 * client IP (Vercel sets x-forwarded-for; falls back to "unknown").
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  clientIp: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, kind: "skip" };
  if (!token) return { ok: false, reason: "missing captcha token" };

  try {
    const r = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: clientIp,
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!r.ok) {
      return { ok: false, reason: `turnstile HTTP ${r.status}` };
    }
    const body = (await r.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!body.success) {
      const codes = body["error-codes"]?.join(",") ?? "unknown";
      return { ok: false, reason: `turnstile rejected: ${codes}` };
    }
    return { ok: true, kind: "verified" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
