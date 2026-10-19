// IndexNow client.
//
// IndexNow is a push protocol shared by Bing, Yandex, Naver, Seznam,
// and Yep · when content updates, you POST the URL list and they
// re-crawl within minutes instead of the typical days-to-weeks. Google
// has not adopted it (they use sitemap pings + Search Console manual
// requests), so this helps with the non-Google long tail.
//
// Spec: https://www.indexnow.org/documentation
//
// Setup (one-time, no code change):
//   1. Generate a random 32-128 char key (alphanumeric + dashes only):
//        openssl rand -hex 32
//   2. Set INDEXNOW_KEY in Vercel env vars · redeploy.
//   3. Verify the key file at https://galaxymind.space/api/indexnow-key
//      returns the key as text/plain. Bing reads this URL to verify
//      site ownership when we submit URLs for re-indexing.
//
// At runtime: any caller with the cron-internal context can call
// pingIndexNow([url1, url2, ...]) to trigger re-indexing of those
// specific URLs. If INDEXNOW_KEY is unset, the call is a no-op
// (returns false) so the helper is safe to call from cron handlers
// regardless of env state.

const SITE_HOST = "galaxymind.space";
// keyLocation must be at a path that's a parent of the URLs being
// submitted. The IndexNow spec uses the key location to scope
// authorization · /api/indexnow-key would only authorize /api/*
// submissions, but we want full-site coverage. The
// /<KEY>.txt root path (set up via Next rewrite in next.config.ts)
// is a parent of every page on the site, so submissions for /stack,
// /treasuries, etc. are all authorized.
function buildKeyUrl(key: string): string {
  return `https://${SITE_HOST}/${key}.txt`;
}
const ENDPOINT = "https://api.indexnow.org/IndexNow";

export type IndexNowResult = {
  ok: boolean;
  status: number;
  reason?: string;
};

export function isIndexNowConfigured(): boolean {
  return !!process.env.INDEXNOW_KEY;
}

export function getIndexNowKey(): string | null {
  return process.env.INDEXNOW_KEY ?? null;
}

/**
 * Submit a list of URLs to IndexNow for re-crawling. URLs must all
 * be on the galaxymind.space host (the spec requires same-host).
 *
 * Returns the API result. Common outcomes:
 *   - 200 OK · accepted, will be processed
 *   - 202 Accepted · key validation pending
 *   - 400 Bad Request · malformed payload
 *   - 403 Forbidden · key validation failed (check the key file URL)
 *   - 422 Unprocessable · URLs reject (wrong host, etc.)
 *   - 429 Too Many Requests · rate-limited (rare; daily limit is high)
 */
export async function pingIndexNow(
  urls: string[],
): Promise<IndexNowResult> {
  const key = getIndexNowKey();
  if (!key) {
    return { ok: false, status: 0, reason: "INDEXNOW_KEY not set" };
  }
  if (urls.length === 0) {
    return { ok: false, status: 0, reason: "no urls" };
  }
  // Same-host validation · IndexNow rejects mixed-host submissions.
  const wrongHost = urls.find((u) => {
    try {
      return new URL(u).hostname !== SITE_HOST;
    } catch {
      return true;
    }
  });
  if (wrongHost) {
    return {
      ok: false,
      status: 0,
      reason: `URL not on ${SITE_HOST}: ${wrongHost}`,
    };
  }

  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        host: SITE_HOST,
        key,
        keyLocation: buildKeyUrl(key),
        urlList: urls,
      }),
      // 5s timeout matches the rest of our outbound fetches in
      // src/lib/market.ts. The fetch IS awaited so the caller can
      // surface IndexNow's response status in its payload, but
      // callers treat IndexNow as best-effort and never fail their
      // own response on its result. NOT a `void promise` fire-and-forget
      // (which would be terminated by Vercel's runtime · see
      // submit-vendor route's M5 fix from 2026-05-14).
      signal: AbortSignal.timeout(5_000),
    });
    return {
      ok: r.ok,
      status: r.status,
      ...(r.ok ? {} : { reason: await r.text().catch(() => undefined) }),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
