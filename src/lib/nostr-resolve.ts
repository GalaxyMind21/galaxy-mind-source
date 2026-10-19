// Nostr handle resolution that touches the network on the server.
//
// Split out of ./nostr-activity (CodeQL review, 2026-10): NIP-05 lookups
// fetch a user-controlled domain through safeFetch, which now pins DNS
// with node:dns / node:https. nostr-activity is also bundled for the
// browser (relay reads in VendorRecentPosts and LiveEconomyStrip), so
// anything that imports safe-fetch has to live here instead.

import { decodeNostrBech32ToPubkey, pickNip05Name } from "./nostr-activity";
import { readCappedJson, safeFetch } from "./safe-fetch";

/**
 * Resolve a NIP-05 identifier (`name@domain.tld`) to the hex pubkey
 * the domain claims. Returns null on any failure (DNS, HTTP, JSON
 * parse, name not listed).
 */
export async function resolveNip05(
  identifier: string,
  fetchTimeoutMs = 5_000,
): Promise<string | null> {
  if (!identifier.includes("@")) return null;
  const [name, domain] = identifier.split("@");
  if (!name || !domain) return null;
  // SSRF guard · the `domain` portion of a NIP-05 identifier is
  // user-controlled (vendor-supplied via /submit form or auto-fetch
  // from existing vendor handles). Validate before making the
  // outbound HTTPS GET to block private IPs, IPv6 literals, custom
  // ports, *.local hostnames, etc. See lib/safe-fetch.ts.
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
  try {
    // safeFetch validates the initial URL AND re-validates every
    // redirect hop. A bare fetch follows 3xx by default, so a validated
    // attacker-owned domain could 302 us into loopback / the cloud
    // metadata IP with the guard never running again (2026-08 audit).
    // NIP-05 endpoints legitimately redirect (www -> apex), so we
    // follow-and-revalidate rather than refusing 3xx outright.
    const r = await safeFetch(url, {
      signal: AbortSignal.timeout(fetchTimeoutMs),
      headers: { "User-Agent": "GalaxyMind/1.0" },
    });
    if (!r || !r.ok) return null;
    const data = (await readCappedJson(r)) as {
      names?: Record<string, string>;
    } | null;
    if (!data) return null;
    return pickNip05Name(data.names, name);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Convenience: resolve a vendor handle to its pubkey
// ─────────────────────────────────────────────────────────────────

/**
 * Resolves a Nostr-platform vendor handle to its hex pubkey,
 * handling all three handle formats:
 *   NIP-05:      name@domain.tld   → DNS lookup
 *   bech32 npub: npub1...          → bech32 decode
 *   bech32 nprofile: nprofile1...  → bech32 + TLV walk
 * Returns null on any failure.
 */
export async function resolveNostrHandleToPubkey(
  handle: string,
): Promise<string | null> {
  if (handle.startsWith("npub1") || handle.startsWith("nprofile1")) {
    return decodeNostrBech32ToPubkey(handle);
  }
  if (handle.includes("@")) {
    return resolveNip05(handle);
  }
  return null;
}
