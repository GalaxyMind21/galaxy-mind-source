// GET /api/auth/x/start[?return=/path] · begins the optional link-your-
// X-account flow for arcade leaderboards (OAuth 2.0 Authorization Code
// + PKCE). Mints state + a PKCE verifier into a short-lived HttpOnly
// cookie and 302s to X's authorize page. 503 when the feature is not
// configured (the UI hides the button in that case · /api/auth/x/me).
//
// Scopes: users.read + tweet.read are the documented minimum for
// GET /2/users/me. No offline.access — we never need a refresh token;
// identity is our own signed cookie, X is only consulted at link time.

import { NextResponse } from "next/server";
import {
  OAUTH_TMP_COOKIE,
  isXIdentityConfigured,
  pkceChallenge,
  randomToken,
  safeReturnPath,
  mintOAuthTmpValue,
} from "@/lib/arcade-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isXIdentityConfigured()) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const ret = safeReturnPath(url.searchParams.get("return"));
  const state = randomToken(24);
  const verifier = randomToken(48); // 64 base64url chars · PKCE-legal length
  const redirectUri = `${url.origin}/api/auth/x/callback`;

  const authorize = new URL("https://x.com/i/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", process.env.X_OAUTH_CLIENT_ID!);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "users.read tweet.read");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const tmp = mintOAuthTmpValue(state, verifier, ret);
  if (!tmp) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  const res = NextResponse.redirect(authorize, 302);
  // HMAC-signed state · verifier · return-path; 10 minutes is plenty
  // to click "authorize" and the cookie is useless after that.
  const secure = url.protocol === "https:";
  res.headers.set(
    "Set-Cookie",
    `${OAUTH_TMP_COOKIE}=${encodeURIComponent(tmp)}; ` +
      `Path=/api/auth/x; Max-Age=600; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
  return res;
}
