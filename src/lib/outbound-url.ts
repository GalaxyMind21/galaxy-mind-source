// Outbound URL and IP address rules for user-controlled destinations.
//
// Pure functions with no Node imports, so client components can use
// isSafeHttpsHref at render time. The fetcher that enforces these rules
// on the wire (redirect re-checks plus DNS pinning) is safeFetch in
// ./safe-fetch, which is server-only because it uses node:https.
//
// Rules for a URL:
//   - HTTPS scheme only (no http://, file://, gopher://, etc.)
//   - Default port 443 only (no `:NNN` overrides)
//   - No userinfo
//   - Hostname that is NOT a literal IP address in any private range
//   - Hostname that is NOT a known internal/metadata DNS name
//
// Rules for a resolved address (isBlockedIp): see the comment above it.

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

// ---------------------------------------------------------------------
// Resolved-address checks (CodeQL review, 2026-10)
// ---------------------------------------------------------------------
//
// validateOutboundUrl only sees the hostname. A public-looking name can
// still resolve to a private address, or answer with a public address
// for the check and a private one for the connection (DNS rebinding).
// safeFetch closes that by resolving the name itself, rejecting the
// answer if ANY address is blocked here, and connecting only to the
// address it checked. These rules cover IPv4 and IPv6, including the
// IPv6 forms that carry an IPv4 address inside them.

/** Parse a strict dotted-quad IPv4 address (no leading zeros). */
function parseStrictIPv4(s: string): [number, number, number, number] | null {
  const ip = parseIPv4(s);
  if (!ip) return null;
  if (s.split(".").some((p) => p.length > 1 && p[0] === "0")) return null;
  return ip;
}

function isBlockedIPv4(ip: [number, number, number, number]): boolean {
  return PRIVATE_IPV4_RANGES.some((range) => ipv4InRange(ip, range));
}

/**
 * Parse an IPv6 address into eight 16-bit groups. Accepts `::`
 * compression, an embedded dotted-quad tail (::ffff:127.0.0.1), and a
 * zone id (fe80::1%eth0), which is dropped. Returns null if malformed.
 */
export function parseIPv6(input: string): number[] | null {
  let s = input.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  // Embedded IPv4 tail becomes two hex groups.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseStrictIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = parseGroups(halves[1]);
  if (!rest) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function embeddedV4(hi: number, lo: number): [number, number, number, number] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isBlockedIPv6(g: number[]): boolean {
  const allZeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::/128 unspecified and ::1/128 loopback.
  if (allZeroUpTo(7) && (g[7] === 0 || g[7] === 1)) return true;
  // ::ffff:0:0/96 IPv4-mapped: judge the IPv4 address inside.
  if (allZeroUpTo(5) && g[5] === 0xffff) return isBlockedIPv4(embeddedV4(g[6], g[7]));
  // ::ffff:0:0:0/96 IPv4-translated (SIIT) and ::/96 IPv4-compatible
  // (deprecated): never a legitimate public destination.
  if (allZeroUpTo(4) && g[4] === 0xffff && g[5] === 0) return true;
  if (allZeroUpTo(6)) return true;
  // 64:ff9b::/96 NAT64: judge the IPv4 address inside.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4(embeddedV4(g[6], g[7]));
  }
  // 64:ff9b:1::/48 local-use NAT64.
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // 100::/64 discard-only.
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  // 2001::/23 IETF protocol assignments (includes Teredo 2001::/32).
  if (g[0] === 0x2001 && g[1] < 0x200) return true;
  // 2001:db8::/32 and 3fff::/20 documentation.
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;
  // 2002::/16 6to4: judge the IPv4 address inside.
  if (g[0] === 0x2002) return isBlockedIPv4(embeddedV4(g[1], g[2]));
  // fc00::/7 unique-local (includes cloud metadata such as fd00:ec2::254).
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local and fec0::/10 site-local (deprecated).
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
  // ff00::/8 multicast.
  if ((g[0] & 0xff00) === 0xff00) return true;
  // Allowlist (PR #188 S-3): beyond the two IPv4-carrying forms judged above
  // (::ffff:0:0/96 mapped and 64:ff9b::/96 NAT64, which go through the full
  // IPv4 rules), only global unicast 2000::/3 is reachable. Odd reserved
  // space such as ::1:2:3:4 or 4000::/3 is refused even if nothing above
  // named it.
  return (g[0] & 0xe000) !== 0x2000;
}

/**
 * True when a resolved address must never be connected to: private,
 * loopback, link-local, unique-local, CGNAT, metadata, multicast,
 * documentation or otherwise special, in IPv4 or IPv6 (including
 * IPv4-mapped, NAT64 and 6to4 forms). Anything that is not a valid IP
 * address is also blocked, so a malformed resolver answer fails closed.
 */
export function isBlockedIp(address: string): boolean {
  if (typeof address !== "string" || !address) return true;
  const v4 = parseStrictIPv4(address.trim());
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6) return isBlockedIPv6(v6);
  return true;
}
