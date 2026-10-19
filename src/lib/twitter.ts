// Minimal X (Twitter) v2 API client for posting tweets.
//
// OAuth 1.0a User Context — required for the POST /2/tweets endpoint.
// We sign requests inline using Node's crypto module rather than
// pulling in an OAuth library, because the only thing we ever do is
// POST text tweets and the signing logic is ~30 lines once you know
// the recipe.
//
// Required env vars (set in Vercel project settings):
//   X_API_KEY              — X developer dashboard → app → keys
//   X_API_SECRET           — same place, the consumer secret
//   X_ACCESS_TOKEN         — generate "Access Token & Secret" in app
//   X_ACCESS_TOKEN_SECRET  — same generation step
//
// All four are required; without them postTweet() returns an explicit
// failure rather than throwing. Build/deploy works without provisioning.
//
// Note on cost: X charges for API access these days. Free tier exists
// (~1500 posts/month write limit at the time of writing) — plenty for
// 2 posts/week. Basic plan is $100/mo if you need more. The code
// works against either tier.
import crypto from "node:crypto";

const TWEETS_ENDPOINT = "https://api.twitter.com/2/tweets";

type TwitterError = { errors?: { message: string }[]; detail?: string };
type TwitterResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; statusCode?: number };

function isTwitterConfigured(): {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
} | null {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

// RFC 3986 percent-encoding (stricter than encodeURIComponent — also
// escapes !*'()).
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Build the OAuth 1.0a Authorization header for a request.
 *
 * Recipe (per RFC 5849 §3.4):
 *   1. Collect all OAuth params + any request body params.
 *   2. Sort by key, then value, alphabetically.
 *   3. Concat as "key=value&key=value" (each component RFC3986 encoded).
 *   4. Build base string: "POST&{encoded_url}&{encoded_params}".
 *   5. Build signing key: "{encoded_consumer_secret}&{encoded_token_secret}".
 *   6. HMAC-SHA1 the base string with the signing key, base64 the digest.
 *   7. Concat all OAuth params back into the Authorization header
 *      with quoted RFC3986-encoded values, comma-separated.
 *
 * For POST /2/tweets we don't include body params in the signature
 * (the body is JSON, not form-encoded — only form-encoded bodies
 * participate in OAuth 1.0a signing).
 */
function buildOAuthHeader(
  cfg: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessTokenSecret: string;
  },
  method: string,
  url: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: cfg.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: cfg.accessToken,
    oauth_version: "1.0",
  };

  const sortedKeys = Object.keys(oauthParams).sort();
  const paramString = sortedKeys
    .map((k) => `${rfc3986(k)}=${rfc3986(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    rfc3986(url),
    rfc3986(paramString),
  ].join("&");

  const signingKey = `${rfc3986(cfg.apiSecret)}&${rfc3986(cfg.accessTokenSecret)}`;

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams.oauth_signature = signature;

  // Header: comma-separated `key="value"` pairs, RFC3986-encoded values.
  const headerString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${rfc3986(k)}="${rfc3986(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerString}`;
}

/**
 * Post a tweet via X v2 API. Returns the new tweet's id on success.
 *
 * X auto-expands the OG card from any URL in the text, so we don't
 * upload media — the existing /stack/opengraph-image renders the
 * gauge as a 1200×630 PNG that gets attached automatically when the
 * link is in the tweet.
 */
export async function postTweet(
  text: string,
  // Optional · when provided, the new tweet is posted as a reply to
  // the given tweet ID. Used by scripts/post-thread.ts to chain a
  // multi-tweet thread sequentially. X v2 API spec: pass the ID in
  // `reply.in_reply_to_tweet_id` of the POST body. There's no batch
  // thread endpoint at the free tier, so threads have to fan out as
  // N sequential calls each pointing back at the previous tweet's id.
  replyToId?: string,
): Promise<TwitterResult<{ id: string }>> {
  const cfg = isTwitterConfigured();
  if (!cfg) {
    return {
      ok: false,
      error:
        "X (Twitter) API not configured. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET in Vercel.",
    };
  }
  // Tweet length validation. X allows 280 characters; URLs count as
  // 23 (auto-shortened by t.co) regardless of true length.
  const URL_RE = /https?:\/\/\S+/g;
  const urlCount = (text.match(URL_RE) ?? []).length;
  const visibleLength =
    text.replace(URL_RE, "").length + urlCount * 23;
  if (visibleLength > 280) {
    return {
      ok: false,
      error: `Tweet exceeds 280 chars (${visibleLength}). Trim and retry.`,
    };
  }

  const auth = buildOAuthHeader(cfg, "POST", TWEETS_ENDPOINT);
  // Build the request payload · only include the `reply` field when
  // we're chaining (presence of the field with a null inside is an
  // error per X spec, so omit entirely when not threading).
  // Renamed from `body` to avoid shadowing the response-body local
  // variable declared further down.
  const requestPayload: {
    text: string;
    reply?: { in_reply_to_tweet_id: string };
  } = { text };
  if (replyToId) {
    requestPayload.reply = { in_reply_to_tweet_id: replyToId };
  }
  try {
    const r = await fetch(TWEETS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
      // The only outbound call without a timeout until 2026-07-11 · a
      // hung X API pinned the calling function to the platform ceiling.
      // 10s (vs upstream.ts's 5s) because a tweet POST is slower than a
      // data read and not idempotent to retry. The surrounding catch
      // already maps the timeout AbortError to ok:false.
      signal: AbortSignal.timeout(10_000),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const err =
        (body as TwitterError | null)?.errors?.[0]?.message ??
        (body as TwitterError | null)?.detail ??
        r.statusText;
      return { ok: false, error: String(err), statusCode: r.status };
    }
    return {
      ok: true,
      data: { id: (body as { data: { id: string } }).data.id },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
