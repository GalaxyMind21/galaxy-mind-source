// GET /api/auth/x/callback · completes the link-your-X flow: verifies
// state, exchanges the code (PKCE + Basic client auth), reads the
// profile once via GET /2/users/me (username + avatar), stores the
// display metadata in the KV profile hash keyed by the IMMUTABLE
// numeric user id, and mints the signed session cookie. Every failure
// lands back on the return path with ?xlink=<reason> — the UI copy
// stays calm, no error pages.
//
// The profile call is the only billed X API resource in the whole
// feature (~$0.01/link under 2026 pay-per-use pricing) · nothing else
// ever talks to X.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  OAUTH_TMP_COOKIE,
  X_PROFILE_HASH,
  isXIdentityConfigured,
  mintSessionValue,
  readOAuthTmpCookie,
  sessionSetCookie,
  legacySessionClearCookie,
  type XProfile,
} from "@/lib/arcade-identity";
import { kvHSet } from "@/lib/kv";
import { matchProfanityOrSlur } from "@/lib/nostr-content-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bounce(origin: string, ret: string, flag: string, cookies: string[]): NextResponse {
  const res = NextResponse.redirect(`${origin}${ret}?xlink=${flag}`, 302);
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

/** Length-padded constant-time string equality (mirrors lib/cron-auth). */
function stateEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  const padLen = Math.max(ba.length, bb.length, 1);
  const aPad = Buffer.alloc(padLen, 0);
  const bPad = Buffer.alloc(padLen, 0);
  ba.copy(aPad);
  bb.copy(bPad);
  return timingSafeEqual(aPad, bPad) && ba.length === bb.length;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const clearTmp = `${OAUTH_TMP_COOKIE}=; Path=/api/auth/x; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

  const tmp = readOAuthTmpCookie(req.headers.get("cookie"));
  const ret = tmp?.ret ?? "/arcade";

  if (!isXIdentityConfigured()) return bounce(url.origin, ret, "off", [clearTmp]);
  if (!tmp) return bounce(url.origin, ret, "expired", [clearTmp]);
  const { state, verifier } = tmp;

  const code = url.searchParams.get("code");
  const gotState = url.searchParams.get("state");
  // user hit "cancel" on X, or state mismatch (CSRF / stale tab).
  // Compare via length-padded buffers so a timing oracle cannot walk
  // the cookie-minted state byte-by-byte (same posture as cron-auth).
  if (!code || !gotState || !stateEquals(gotState, state)) {
    return bounce(url.origin, ret, "cancelled", [clearTmp]);
  }

  // ── code → token ──────────────────────────────────────────────────
  let accessToken: string | null = null;
  try {
    const basic = Buffer.from(
      `${process.env.X_OAUTH_CLIENT_ID}:${process.env.X_OAUTH_CLIENT_SECRET}`,
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/api/auth/x/callback`,
      code_verifier: verifier,
      client_id: process.env.X_OAUTH_CLIENT_ID!,
    });
    const r = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (r.ok) {
      const j = (await r.json()) as { access_token?: string };
      accessToken = j.access_token ?? null;
    }
  } catch {
    /* network / timeout · fall through to the bounce below */
  }
  if (!accessToken) return bounce(url.origin, ret, "failed", [clearTmp]);

  // ── who is this? (the one billed call) ────────────────────────────
  let userId: string | null = null;
  let handle: string | null = null;
  let avatar: string | undefined;
  try {
    const r = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
    if (r.ok) {
      const j = (await r.json()) as {
        data?: { id?: string; username?: string; profile_image_url?: string };
      };
      if (j.data?.id && /^\d{1,25}$/.test(j.data.id) && j.data.username) {
        userId = j.data.id;
        handle = j.data.username.slice(0, 15); // X's own max
        avatar =
          typeof j.data.profile_image_url === "string" &&
          j.data.profile_image_url.startsWith("https://")
            ? j.data.profile_image_url
            : undefined;
      }
    }
  } catch {
    /* fall through */
  }
  if (!userId || !handle) return bounce(url.origin, ret, "failed", [clearTmp]);

  // Same choke-point screen the culture handles pass through · a slur
  // in an X handle must not seat a public board row via the side door.
  if (matchProfanityOrSlur(handle)) {
    return bounce(url.origin, ret, "refused", [clearTmp]);
  }

  const profile: XProfile = { h: handle, t: Math.floor(Date.now() / 1000) };
  if (avatar) profile.a = avatar;
  await kvHSet(X_PROFILE_HASH, userId, profile);

  const session = mintSessionValue(userId);
  if (!session) return bounce(url.origin, ret, "failed", [clearTmp]);
  return bounce(url.origin, ret, "ok", [
    clearTmp,
    sessionSetCookie(session, secure),
    // retire the pre-__Host- bare-name cookie so only one session cookie remains
    ...(secure ? [legacySessionClearCookie(true)] : []),
  ]);
}
