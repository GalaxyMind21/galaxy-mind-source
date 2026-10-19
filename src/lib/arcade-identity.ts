// Arcade X-identity · optional "link your X account" layer over the
// anonymous culture handles (2026-07-14).
//
// Design contract (do not weaken):
//   · OPTIONAL and additive. Boards keep working logged-out, with the
//     env vars unset, and when X's API is down — X is only in the loop
//     at link time. The anonymous posting path stays byte-identical.
//   · The session is a stateless HMAC-signed cookie ("gm_xs") holding
//     {xUserId, expiry}. HttpOnly + SameSite=Lax + Secure. HttpOnly
//     matters: super-saylor runs under script-src 'unsafe-inline', so
//     nothing readable-from-JS should carry identity.
//   · ARCADE_SESSION_SECRET is DEDICATED and fail-closed (the
//     UNSUB_SECRET audit precedent) — never derive it from CRON_SECRET
//     or any other secret; a cron-secret leak must not become an
//     identity-forgery primitive on public boards.
//   · Verified board members are "x:{userId}" — a shape that can never
//     collide with the culture-handle HANDLE_RE, so no board version
//     bump and old rows keep working. Display metadata (handle, avatar)
//     lives in ONE KV hash keyed by the immutable numeric user id;
//     handle changes on X only refresh on relink, the id is canonical.

import { createHmac, timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { kvHMGetChecked } from "./kv";

/**
 * Session cookie (security audit 2026-10-18, L9). On HTTPS the name carries the `__Host-` prefix, so the browser only
 * accepts it with Secure, Path=/ and no Domain: a sibling subdomain or a plain-HTTP response can never plant or
 * overwrite it. Plain-HTTP local dev keeps the bare name (browsers reject `__Host-` without Secure). Sessions minted
 * under the old bare name are still read until LEGACY_SESSION_SUNSET (2027-01-31) and are cleared on the next link
 * or logout. After the sunset a production deploy ignores the bare name entirely, so a sibling-planted bare cookie no
 * longer authenticates; plain-HTTP dev (NODE_ENV != production) keeps reading it because that is its only name.
 */
export const SESSION_COOKIE = "__Host-gm_xs";
export const LEGACY_SESSION_COOKIE = "gm_xs";
export const LEGACY_SESSION_SUNSET_MS = Date.UTC(2027, 0, 31, 6); // 2027-01-31 00:00 CT
/** Whether the bare legacy name is still accepted as a session at `nowMs`. */
export const legacySessionReadable = (nowMs: number, nodeEnv: string | undefined = process.env.NODE_ENV): boolean =>
  nodeEnv !== "production" || nowMs < LEGACY_SESSION_SUNSET_MS;
export const sessionCookieName = (secure: boolean): string => (secure ? SESSION_COOKIE : LEGACY_SESSION_COOKIE);
export const OAUTH_TMP_COOKIE = "gm_xoauth";
/** One KV hash for every linked profile · field = X user id. */
export const X_PROFILE_HASH = "gm:arcade:xprofiles";

const SESSION_TTL_S = 180 * 24 * 3600; // 180 days · relink is one tap

/** Stored per linked account · compact keys, it lives in a KV hash. */
export type XProfile = {
  h: string; // @handle at link time (display only · id is canonical)
  a?: string; // profile_image_url at link time
  t: number; // linked-at unix seconds
};

export function isXIdentityConfigured(): boolean {
  return !!(
    process.env.X_OAUTH_CLIENT_ID &&
    process.env.X_OAUTH_CLIENT_SECRET &&
    sessionSecret()
  );
}

function sessionSecret(): Buffer | null {
  const s = process.env.ARCADE_SESSION_SECRET;
  // Fail CLOSED on missing or trivially short secrets · a link button
  // that silently signs with "" would be an identity-forgery hole.
  if (!s || s.length < 16) return null;
  return Buffer.from(s, "utf8");
}

function sign(payload: string): string | null {
  const k = sessionSecret();
  if (!k) return null;
  return createHmac("sha256", k).update(payload).digest("base64url");
}

/** Mint the signed cookie VALUE (caller sets the Set-Cookie header). */
export function mintSessionValue(
  userId: string,
  nowMs: number = Date.now(),
): string | null {
  if (!/^\d{1,25}$/.test(userId)) return null;
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_S;
  const payload = `${userId}.${exp}`;
  const mac = sign(payload);
  return mac ? `${payload}.${mac}` : null;
}

/**
 * Read + verify the session from a Cookie header. Returns null on any
 * problem — absent cookie, bad shape, expired, bad MAC, or unset secret
 * (fail closed). Never throws.
 */
export function readXSession(
  cookieHeader: string | null,
  nowMs: number = Date.now(),
): { userId: string } | null {
  try {
    if (!cookieHeader) return null;
    const m =
      cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`)) ??
      (legacySessionReadable(nowMs) ? cookieHeader.match(new RegExp(`(?:^|;\\s*)${LEGACY_SESSION_COOKIE}=([^;]+)`)) : null);
    if (!m) return null;
    const parts = decodeURIComponent(m[1]).split(".");
    if (parts.length !== 3) return null;
    const [userId, expStr, mac] = parts;
    if (!/^\d{1,25}$/.test(userId) || !/^\d{1,12}$/.test(expStr)) return null;
    if (Number(expStr) * 1000 < nowMs) return null;
    const want = sign(`${userId}.${expStr}`);
    if (!want) return null;
    const a = Buffer.from(mac);
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { userId };
  } catch {
    return null;
  }
}

/** Serialize the session Set-Cookie header value (`__Host-` name on HTTPS). */
export function sessionSetCookie(value: string, secure: boolean): string {
  return (
    `${sessionCookieName(secure)}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_TTL_S}; ` +
    `HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

/** Serialize the session-clearing Set-Cookie header value for the current name. */
export function sessionClearCookie(secure: boolean): string {
  return `${sessionCookieName(secure)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Clears the pre-2026-10-18 bare-name cookie (sent alongside a new session or a logout). */
export function legacySessionClearCookie(secure: boolean): string {
  return `${LEGACY_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Every Set-Cookie value a logout sends: the current name plus the legacy one on HTTPS. */
export function sessionClearCookies(secure: boolean): string[] {
  return secure ? [sessionClearCookie(true), legacySessionClearCookie(true)] : [sessionClearCookie(false)];
}

// ----- OAuth 2.0 + PKCE plumbing (used by /api/auth/x/*) -----------

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** S256 code challenge for a PKCE verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Post-link return path allow-list: site-internal paths only, so
 * ?return= can never become an open redirect (or header/control-char
 * smuggling into Location).
 *
 * Refuses:
 *   · absolute URLs / scheme-bearing strings
 *   · protocol-relative (`//evil`)
 *   · backslash tricks (`/\evil`, `/a\b`) some browsers normalize oddly
 *   · any `//` sequence (incl. `/..//evil.com`, `///evil`)
 *   · C0 control chars + DEL (CR/LF/NUL/tab) — Next's URL() strips
 *     some of these, but we never put raw controls into Location
 */
export function safeReturnPath(p: string | null): string {
  if (
    !p ||
    !p.startsWith("/") ||
    p.startsWith("//") ||
    p.includes("\\") ||
    p.includes("//") ||
    p.includes("://") ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(p)
  ) {
    return "/arcade";
  }
  return p;
}

/**
 * Session plus the profile-hash revocation signal.
 *
 * Unlink deletes the X profile field. The HMAC cookie lives 180 days
 * with no server-side list, so `readXSession` alone cannot know. Cloud
 * POST and /me already check the hash; score / dare / ghost writes
 * must too, or a second device keeps posting as `x:{id}`.
 */
export type LinkedSession =
  | { kind: "anonymous" }
  | { kind: "linked"; userId: string }
  | { kind: "unlinked" }
  | { kind: "read_failed" };

export async function resolveLinkedSession(
  cookieHeader: string | null,
): Promise<LinkedSession> {
  const xs = readXSession(cookieHeader);
  if (!xs) return { kind: "anonymous" };
  const { ok, values } = await kvHMGetChecked<XProfile>(X_PROFILE_HASH, [
    xs.userId,
  ]);
  if (!ok) return { kind: "read_failed" };
  if (values[0] == null) return { kind: "unlinked" };
  return { kind: "linked", userId: xs.userId };
}

/** HMAC-signed OAuth temp cookie (state + PKCE verifier + return path). */
export function mintOAuthTmpValue(
  state: string,
  verifier: string,
  ret: string,
): string | null {
  const payload = `${state}.${verifier}.${safeReturnPath(ret)}`;
  const mac = sign(payload);
  return mac ? `${payload}.${mac}` : null;
}

export function readOAuthTmpCookie(
  cookieHeader: string | null,
): { state: string; verifier: string; ret: string } | null {
  try {
    if (!cookieHeader) return null;
    const m = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${OAUTH_TMP_COOKIE}=([^;]+)`),
    );
    if (!m) return null;
    const decoded = decodeURIComponent(m[1]);
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot <= 0) return null;
    const payload = decoded.slice(0, lastDot);
    const mac = decoded.slice(lastDot + 1);
    const want = sign(payload);
    if (!want) return null;
    const a = Buffer.from(mac);
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const parts = payload.split(".");
    if (parts.length < 3) return null;
    const [state, verifier] = parts;
    if (!state || !verifier) return null;
    return {
      state,
      verifier,
      ret: safeReturnPath(parts.slice(2).join(".")),
    };
  } catch {
    return null;
  }
}
