// SSRF guard for server-side fetches to user-controlled domains.
//
// Used by:
//   - /api/enrich-handle · LNURL-pay endpoint fetch
//   - lib/nostr-activity.ts · NIP-05 well-known file fetch
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
//
// The validator below rejects all of the above BEFORE making the
// fetch — but ONLY for the URL it is handed. A bare `fetch()` defaults
// to `redirect: "follow"`, so a validated public domain answering 302
// `Location: http://127.0.0.1/` used to walk straight past this guard
// (2026-08 audit). Use `safeFetch()` at the bottom of this file for any
// user-controlled URL: it re-validates every hop. Call
// `validateOutboundUrl` directly only when you are NOT fetching (e.g.
// isSafeHttpsHref at render time, or push endpoint intake).
//
// We allow only:
//   - HTTPS scheme (no http://, file://, gopher://, etc.)
//   - Default port 443 only (no `:NNN` overrides)
//   - Hostname that is NOT a literal IP address in any private range
//   - Hostname that is NOT a known internal/metadata DNS name
//
// We do NOT do DNS rebinding protection (would require resolving the
// hostname ourselves, pinning the result, then forcing the fetch to
// use that IP · adds latency and complexity for a low-stakes feature).
// The trade-off is: a sophisticated attacker controlling DNS could
// still pivot to internal IPs after the validator passes. Accepted.

const PRIVATE_IPV4_RANGES: Array<[number, number, number, number, number]> = [
  // [a, b, c, d, prefix] · matches a.b.c.d/prefix
  [10, 0, 0, 0, 8],          // RFC 1918 · 10.0.0.0/8
  [172, 16, 0, 0, 12],       // RFC 1918 · 172.16.0.0/12
  [192, 168, 0, 0, 16],      // RFC 1918 · 192.168.0.0/16
  [127, 0, 0, 0, 8],         // Loopback · 127.0.0.0/8
  [169, 254, 0, 0, 16],      // Link-local · 169.254.0.0/16 (incl. cloud metadata)
  [0, 0, 0, 0, 8],           // Unspecified · 0.0.0.0/8
  [100, 64, 0, 0, 10],       // Carrier-grade NAT · 100.64.0.0/10
  // Security audit 2026-10-18 (L5): remaining IANA special-purpose ranges.
  [192, 0, 0, 0, 24],        // IETF protocol assignments · 192.0.0.0/24
  [192, 0, 2, 0, 24],        // TEST-NET-1 (documentation) · 192.0.2.0/24
  [198, 18, 0, 0, 15],       // Benchmarking · 198.18.0.0/15
  [198, 51, 100, 0, 24],     // TEST-NET-2 (documentation) · 198.51.100.0/24
  [203, 0, 113, 0, 24],      // TEST-NET-3 (documentation) · 203.0.113.0/24
  [224, 0, 0, 0, 4],         // Multicast · 224.0.0.0/4
  [240, 0, 0, 0, 4],         // Reserved + limited broadcast · 240.0.0.0/4
];

const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.com",
]);

// IPv6 literals that match loopback / unspecified / link-local /
// unique-local. We don't enumerate every range · just block IPv6
// entirely for user-controlled fetches. The Bitcoin-vendor use case
// is solved by IPv4 + DNS hostnames; supporting raw IPv6 literals
// adds attack surface for ~zero benefit.
function isIPv6Literal(host: string): boolean {
  return host.includes(":");
}

function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number.parseInt(p, 10);
    if (n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

function ipv4InRange(
  ip: [number, number, number, number],
  range: [number, number, number, number, number],
): boolean {
  const [a, b, c, d] = ip;
  const [ra, rb, rc, rd, prefix] = range;
  // Pack to a 32-bit unsigned int and bitmask compare.
  const ipInt = (a << 24) | (b << 16) | (c << 8) | d;
  const rangeInt = (ra << 24) | (rb << 16) | (rc << 8) | rd;
  const mask = prefix === 0 ? 0 : ~((1 << (32 - prefix)) - 1);
  // >>> 0 forces unsigned interpretation (JS bitwise ops are signed).
  return ((ipInt & mask) >>> 0) === ((rangeInt & mask) >>> 0);
}

export type SafeFetchValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates a URL string for safe outbound fetching to a
 * user-controlled domain. Returns ok:true if the fetch should
 * proceed, ok:false with a reason otherwise.
 *
 * Callers should ALWAYS check the result before fetch() · this
 * function does not perform the fetch itself.
 */
/**
 * True when a string is safe to put in an `<a href>` on a public page:
 * same HTTPS + non-private host rules as validateOutboundUrl. Use at
 * render time so a bad commit cannot become a live outbound link.
 */
export function isSafeHttpsHref(urlStr: string | null | undefined): boolean {
  if (typeof urlStr !== "string" || !urlStr) return false;
  return validateOutboundUrl(urlStr).ok;
}

export function validateOutboundUrl(urlStr: string): SafeFetchValidation {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `protocol must be https (got ${url.protocol})` };
  }
  // Userinfo (`https://user:pass@host/`) is never needed for LNURL /
  // NIP-05 / shop links and would leak into visitor <a href>s.
  if (url.username || url.password) {
    return { ok: false, reason: "userinfo not allowed" };
  }
  // Non-default port? Block · LNURL-pay and NIP-05 endpoints are
  // always served on the standard 443. A custom port is a strong
  // signal of attempted SSRF (e.g. `:22` to probe SSH, `:5432` to
  // probe Postgres on internal infra).
  if (url.port && url.port !== "443") {
    return { ok: false, reason: `non-default port not allowed (got :${url.port})` };
  }
  // Strip the DNS root label(s) before every hostname test below.
  // 2026-08 audit: `new URL("https://localhost./")` keeps the trailing
  // dot verbatim (domain-to-ASCII runs with VerifyDnsLength=false), and
  // resolvers treat "localhost." as a fully-qualified "localhost". A raw
  // hostname therefore slipped BOTH the exact-match BLOCKED_HOSTNAMES
  // check and the `.local` / `.internal` suffix tests — reachable in
  // prod via `POST /api/push/subscribe`, whose endpoint goes straight
  // to validateSubscription -> validateOutboundUrl with no host regex
  // in front of it (the NIP-05 / LNURL callers happen to be shielded by
  // their own `\.[a-zA-Z]{2,}$` handle regexes, but that is incidental,
  // not a control). Normalize once, here, so every caller inherits it.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return { ok: false, reason: "empty hostname" };

  // Block IPv6 literals (incl. [::1], [::], etc.) wholesale.
  if (isIPv6Literal(host) || host.startsWith("[")) {
    return { ok: false, reason: "IPv6 literal hostnames not allowed" };
  }

  // Block well-known dangerous hostnames.
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `hostname "${host}" is blocked` };
  }

  // Block any *.local mDNS hostnames.
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: `*.local / *.internal hostnames not allowed` };
  }

  // 2026-05 adversarial audit (H4 · corroborated by two passes):
  // `parseIPv4` only accepts strict 4-part dotted decimal and returns
  // null otherwise — and a null parse fell through to "looks public ·
  // allow". That let NON-dotted-decimal IP literals that Node's
  // fetch/undici + the OS resolver WILL still connect to slip past the
  // private-range check entirely:
  //   · decimal dword:   https://2130706433/      (= 127.0.0.1)
  //   · octal:           https://0177.0.0.1/      (0177 = 127)
  //   · hex:             https://0x7f.0.0.1/
  //   · short form:      https://127.1/           (3 parts → 127.0.0.1)
  // Real DNS hostnames ALWAYS contain a non-digit, non-dot character
  // (the alphabetic TLD). So "host is only [0-9.] / starts 0x / has an
  // octal-leading-zero octet, but is NOT a clean public dotted-quad"
  // is an unambiguous IP-literal-obfuscation signal → reject. This has
  // near-zero false-positive risk for legitimate hostnames.
  const looksNumericIpish =
    /^[0-9.]+$/.test(host) || /^0x[0-9a-f]/i.test(host);
  if (looksNumericIpish) {
    const ipv4 = parseIPv4(host);
    if (!ipv4) {
      // Numeric/IP-shaped but not a clean 4-part decimal quad
      // (dword / octal / hex / short-form). The resolver would still
      // route it, possibly to loopback/internal — refuse outright.
      return {
        ok: false,
        reason: `ambiguous IP-literal host "${host}" not allowed (use a hostname or plain dotted-quad)`,
      };
    }
    // Clean dotted-quad: also reject any octet written with a leading
    // zero (octal ambiguity across resolvers, e.g. 010 = 8 or 10).
    if (host.split(".").some((p) => p.length > 1 && p[0] === "0")) {
      return {
        ok: false,
        reason: `IPv4 octet with leading zero (octal-ambiguous) not allowed: "${host}"`,
      };
    }
    for (const range of PRIVATE_IPV4_RANGES) {
      if (ipv4InRange(ipv4, range)) {
        return {
          ok: false,
          reason: `IPv4 ${host} is in private/loopback range`,
        };
      }
    }
  }

  // Hostname looks public · allow.
  return { ok: true };
}

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
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validation = validateOutboundUrl(current);
    if (!validation.ok) {
      // Only log past hop 0 · the caller already logs its own initial
      // reject with richer context, and a redirect reject is the
      // interesting (attack-shaped) event worth surfacing on its own.
      if (hop > 0) {
        console.warn(
          `[safe-fetch] redirect blocked · hop=${hop} · ${validation.reason}`,
        );
      }
      return null;
    }
    let res: Response;
    try {
      res = await fetch(current, { ...init, redirect: "manual" });
    } catch {
      return null;
    }
    // 304 is not a redirect for our purposes and carries no Location.
    const isRedirect =
      res.status === 301 ||
      res.status === 302 ||
      res.status === 303 ||
      res.status === 307 ||
      res.status === 308;
    if (!isRedirect) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    // Resolve relative Locations against the CURRENT url, then loop so
    // the next iteration re-validates the absolute result.
    try {
      current = new URL(location, current).toString();
    } catch {
      return null;
    }
  }
  console.warn(`[safe-fetch] too many redirects (> ${maxRedirects})`);
  return null;
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
