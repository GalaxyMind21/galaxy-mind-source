// SSRF guard for server-side fetches to user-controlled domains.
// Server-only: it uses node:dns and node:https. Client code that only
// needs the URL rules imports them from ./outbound-url instead.
//
// Used by:
//   - /api/enrich-handle · LNURL-pay endpoint fetch
//   - lib/nostr-activity.ts · NIP-05 well-known file fetch
//   - lib/vendor-probe.ts, lib/ownership-proof.ts and operator scripts
//
// Threat model: a vendor submitting via /submit (or any HTTP caller)
// supplies a handle like `name@<domain>`. We then make a server-side
// HTTPS GET to that domain. Without validation, an attacker could:
//
//   - Pass `127.0.0.1` or `localhost` to probe loopback services
//   - Pass private RFC-1918 IPs (10.*, 172.16-31.*, 192.168.*) to
//     probe internal infra · Vercel's serverless sandbox usually
//     blocks this but defense-in-depth says don't rely on the runtime
//   - Pass cloud-provider metadata endpoints (169.254.169.254 ·
//     `metadata.google.internal` · `metadata` on Azure) to leak
//     credentials from the function's IAM context
//   - Pass `[::1]` or other IPv6 loopback variants
//   - Use port specifiers like `domain:22` to enumerate services
//   - Point a public-looking hostname at a private address, or answer
//     DNS with a public address for the check and a private one for the
//     connection (DNS rebinding)
//
// The pinned transport and the redirect chain live in ./safe-fetch-core.
// This module is the only src/ entry point: safeFetch here has no
// transport option, so src/ code cannot swap the wire layer.
//
// Three layers stop these:
//   1. validateOutboundUrl (./outbound-url) checks the URL string:
//      HTTPS, port 443, no userinfo, no private IP literal, no internal
//      hostname.
//   2. safeFetch follows redirects by hand and re-runs layer 1 on every
//      hop (2026-08 audit).
//   3. The connection itself resolves the hostname through a pinned
//      lookup (CodeQL review, 2026-10): every address in the DNS answer
//      must pass isBlockedIp, and the socket connects to the address
//      that was checked. The check and the connect use one lookup, so
//      there is no second resolution for a rebinding answer to slip into.
//
// Call `validateOutboundUrl` directly only when you are NOT fetching
// (e.g. isSafeHttpsHref at render time, or push endpoint intake).

import {
  createPinnedTransport,
  runSafeFetch,
  SAFE_FETCH_DEFAULT_TIMEOUT_MS,
} from "./safe-fetch-core";

export {
  isBlockedIp,
  isSafeHttpsHref,
  validateOutboundUrl,
  type SafeFetchValidation,
} from "./outbound-url";
export {
  BlockedAddressError,
  createPinnedLookup,
  SAFE_FETCH_DEFAULT_TIMEOUT_MS,
  type Resolver,
} from "./safe-fetch-core";

// The wire transport is fixed: the DNS-pinned node:https transport. There is
// no transport option here (review S4-a). Tests and operator scripts that
// need one import ./safe-fetch-transport, which src/ never may.
const defaultTransport = createPinnedTransport();

/**
 * Fetch a user-controlled URL with the SSRF guard applied to EVERY hop.
 *
 * 2026-08 audit · the finding this exists to fix: `validateOutboundUrl`
 * only ever saw the URL string the caller BUILT. Both user-domain
 * callers then handed that URL to a bare `fetch()`, which defaults to
 * `redirect: "follow"` — so an attacker pointed a handle at a domain
 * they own, passed the guard cleanly, and had their server answer 302
 * `Location: http://127.0.0.1:6379/` (or the cloud metadata IP). undici
 * followed it and the guard never ran a second time. The header comment
 * at the top of this file claims we "reject all of the above BEFORE
 * making the fetch"; for a redirected request that was simply untrue.
 *
 * Rejecting redirects outright is NOT an option: NIP-05 and LNURL-pay
 * endpoints legitimately redirect (www -> apex, hosting-provider edges),
 * so that would drop real vendors. Instead we follow manually and
 * re-validate each `Location` under the same rules, which is the only
 * version that is both safe and true to how these endpoints behave.
 *
 * Returns the final Response, or null if any hop fails validation /
 * the chain exceeds `maxRedirects` / the fetch throws. Callers treat
 * null exactly like a failed fetch — every existing call site already
 * has that branch.
 */
export async function safeFetch(
  urlStr: string,
  init: RequestInit = {},
  maxRedirects = 3,
): Promise<Response | null> {
  return runSafeFetch(urlStr, init, maxRedirects, defaultTransport, SAFE_FETCH_DEFAULT_TIMEOUT_MS);
}

/** Default cap for attacker-controlled JSON (NIP-05 / LNURL well-known). */
export const USER_JSON_MAX_BYTES = 128 * 1024;

/**
 * Read a Response body with a hard byte cap, then JSON.parse.
 * Returns null on oversize, read failure, or invalid JSON.
 *
 * The cap bounds what is READ. `res.text()` buffers the entire body
 * before the length check can run, so a hostile NIP-05 or LNURL host
 * could spend the function's memory inside the 5s timeout. The stream
 * is cancelled as soon as the cap is crossed.
 */
export async function readCappedJson(
  res: Response,
  maxBytes = USER_JSON_MAX_BYTES,
): Promise<unknown | null> {
  const raw = await readCappedText(res, maxBytes);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readCappedText(
  res: Response,
  maxBytes: number,
): Promise<string | null> {
  const stream = res.body;
  if (!stream) {
    // Some runtimes and test doubles expose no stream. Content-Length
    // still lets us refuse before buffering when the server sent one.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      console.warn(`[safe-fetch] response over ${maxBytes} bytes · dropped`);
      return null;
    }
    try {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        console.warn(`[safe-fetch] response over ${maxBytes} bytes · dropped`);
        return null;
      }
      return new TextDecoder().decode(buf);
    } catch {
      return null;
    }
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let over = false;
  try {
    while (total <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      if (total + value.length > maxBytes) {
        over = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
  await reader.cancel().catch(() => {});
  if (over) {
    console.warn(`[safe-fetch] response over ${maxBytes} bytes · dropped`);
    return null;
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(combined);
}
