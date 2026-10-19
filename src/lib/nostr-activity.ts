// Nostr activity helpers · pure-JS bech32 decoder + relay query.
//
// Used by:
//   - scripts/audit-vendors.ts · manual vendor sweep
//   - src/app/api/cron/audit-vendor-activity/route.ts · daily
//     dormancy mark/clear
//   - future: src/lib/vendor-enrichment.ts · build-time kind:0
//     profile metadata fetch
//
// Dependency stance (revised · audit 2026-05, finding D1):
//
//   • bech32 handle DECODING stays pure-JS — extracting the hex
//     pubkey from npub1.../nprofile1... is ~80 lines of trivial
//     base32+checksum+TLV and needs no crypto library.
//
//   • event SIGNATURE VERIFICATION does require real crypto and is
//     NOT optional. Nostr's security model (NIP-01) treats relays as
//     UNTRUSTED infrastructure: a relay can return any bytes for any
//     filter. We render vendor kind:1 posts on /v/[slug] and feed
//     kind:1 timestamps into the dormancy cron — without verifying
//     the BIP-340 Schnorr signature, a colluding/compromised relay
//     could attribute fabricated text to a vendor (a scam vector
//     against the directory's core trust promise) or flip a vendor's
//     dormancy state. So we now verify every event before trusting
//     it (see verifyNostrEvent).
//
// Chosen libs: @noble/curves (schnorr) + @noble/hashes (sha256) —
// Cure53/Trail-of-Bits-audited, single-author, ZERO transitive deps,
// isomorphic + synchronous (this module also runs in the browser via
// the "use client" <VendorRecentPosts>, so node:crypto / async
// WebCrypto are both unusable here). This is the minimal correct
// footprint, not dependency creep.

import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
// bytesToHex is the file's existing local helper (defined below, also
// used by the bech32 decoder) — identical behavior, so we don't
// shadow it with noble's. Only hexToBytes + utf8ToBytes are new.
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const NOSTR_DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

// ─────────────────────────────────────────────────────────────────
// Bech32 decoder · BIP-173 + NIP-19
// ─────────────────────────────────────────────────────────────────

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Decode(s: string): { hrp: string; data: number[] } | null {
  s = s.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length) return null;
  const hrp = s.slice(0, sep);
  const dataChars = s.slice(sep + 1);
  const data: number[] = [];
  for (const c of dataChars) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v === -1) return null;
    data.push(v);
  }
  // Trim the 6-character bech32 checksum · we trust the source.
  return { hrp, data: data.slice(0, -6) };
}

function from5to8(data: number[]): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const v of data) {
    if (v < 0 || v >> 5 !== 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
}

/**
 * Extract a hex pubkey from an npub1... or nprofile1... handle.
 *   npub1     · payload IS the 32-byte pubkey → return as-is.
 *   nprofile1 · TLV-encoded; type 0 = pubkey (32 bytes, always
 *              first). Walk TLVs and pull the type-0 value.
 * Returns null on any decode failure.
 */
export function decodeNostrBech32ToPubkey(handle: string): string | null {
  const decoded = bech32Decode(handle);
  if (!decoded) return null;
  const bytes = from5to8(decoded.data);
  if (!bytes) return null;

  if (decoded.hrp === "npub") {
    if (bytes.length < 32) return null;
    return bytesToHex(bytes.slice(0, 32));
  }
  if (decoded.hrp === "nprofile") {
    let i = 0;
    while (i + 2 <= bytes.length) {
      const type = bytes[i];
      const len = bytes[i + 1];
      const valStart = i + 2;
      if (valStart + len > bytes.length) return null;
      if (type === 0 && len === 32) {
        return bytesToHex(bytes.slice(valStart, valStart + len));
      }
      i = valStart + len;
    }
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// NIP-05 resolution · name@domain → pubkey hex
// ─────────────────────────────────────────────────────────────────

// resolveNip05 and resolveNostrHandleToPubkey live in ./nostr-resolve
// (server-only): they fetch user-controlled domains through safeFetch,
// which uses node:https for DNS pinning, and this module is also loaded
// by client components (VendorRecentPosts, LiveEconomyStrip).

/**
 * Look up a NIP-05 local part in a `names` map, case-insensitively
 * (2026-07-29).
 *
 * Found by scripts/nostr-starter-pack.ts: the vendor handle
 * `Trails@trailscoffee.com` never resolved, because the lookup was an
 * exact-case `names[name]` while the server keys that entry as
 * `"trails"`. NIP-05 says the local part is lowercase and clients
 * normalise, so the capitalised form in our roster is the kind of thing
 * a human types once and nobody notices — it silently broke this
 * vendor's dormancy checks, recent-posts panel, and kind:0 enrichment.
 *
 * Case-fold ONLY, never fuzzy — the same rule lib/ln-guard.ts follows.
 * `trails` and `trai1s` are different identities; `Trails` and `trails`
 * are not.
 *
 * Exported for direct testing so this needs no network to prove.
 */
export function pickNip05Name(
  names: Record<string, string> | undefined,
  name: string,
): string | null {
  if (!names || typeof names !== "object") return null;
  // Exact hit first · the overwhelmingly common path, and it avoids
  // scanning a large names map (trailscoffee.com publishes ~30).
  const exact = names[name];
  if (typeof exact === "string" && exact) return exact;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(names)) {
    if (k.toLowerCase() === lower && typeof v === "string" && v) return v;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Event signature verification · NIP-01 (audit 2026-05 · D1)
// ─────────────────────────────────────────────────────────────────

// A raw event as it arrives off the wire (data[2] of an "EVENT"
// frame). Every field is `unknown` until verifyNostrEvent proves it.
export type RawNostrEvent = {
  id?: unknown;
  pubkey?: unknown;
  created_at?: unknown;
  kind?: unknown;
  tags?: unknown;
  content?: unknown;
  sig?: unknown;
};

const HEX_32 = /^[0-9a-f]{64}$/; // 32-byte id / x-only pubkey
const HEX_64 = /^[0-9a-f]{128}$/; // 64-byte schnorr sig

/**
 * Verify a Nostr event per NIP-01 "Events and signatures". Returns
 * true ONLY if ALL of:
 *
 *   1. every field is well-formed (lowercase-hex id/pubkey/sig of the
 *      exact byte length, numeric created_at/kind, array tags, string
 *      content);
 *   2. `pubkey` equals the author we queried — a malicious relay can
 *      ignore the REQ `authors` filter and return a perfectly-signed
 *      event from a DIFFERENT key, so signature validity alone is
 *      insufficient (it proves "someone signed this", not "the vendor
 *      signed this");
 *   3. `id` == sha256(NIP-01 serialization) — proves the id (which is
 *      what the signature commits to) actually covers this content;
 *   4. BIP-340 schnorr.verify(sig, id, pubkey) holds.
 *
 * FAIL-SAFE: any malformed field, mismatch, or thrown error → false.
 * The caller drops the event; the page degrades to "no recent posts"
 * / the dormancy cron treats the vendor as silent — never displays or
 * trusts unverified relay bytes.
 *
 * Pubkey/id comparisons are plain (non-constant-time): all operands
 * are public data, there is no secret to leak via timing.
 */
export function verifyNostrEvent(
  ev: RawNostrEvent,
  expectedPubkeyHex: string,
): boolean {
  try {
    const { id, pubkey, created_at, kind, tags, content, sig } = ev;
    if (
      typeof id !== "string" ||
      !HEX_32.test(id) ||
      typeof pubkey !== "string" ||
      !HEX_32.test(pubkey) ||
      typeof created_at !== "number" ||
      // created_at rides INSIDE the signed payload, so a compromised
      // vendor key (or hostile relay replaying one) can sign any
      // number · a validly-signed created_at of 1e15 survives every
      // signature check and then throws RangeError the moment a
      // renderer calls new Date(created_at * 1000).toISOString()
      // (LiveEconomyStrip on the homepage, VendorRecentPosts on /v).
      // Bound it to wall-clock sanity: positive integer, at most
      // 15 minutes ahead (NIP-22-style tolerance for clock skew).
      !Number.isInteger(created_at) ||
      created_at <= 0 ||
      created_at > Date.now() / 1000 + 900 ||
      typeof kind !== "number" ||
      !Array.isArray(tags) ||
      typeof content !== "string" ||
      typeof sig !== "string" ||
      !HEX_64.test(sig)
    ) {
      return false;
    }
    // (2) Must be the key we asked for. Defeats a relay that returns
    // a validly-signed event from an unrelated pubkey.
    if (pubkey !== expectedPubkeyHex.toLowerCase()) return false;

    // (3) Recompute the id. NIP-01 canonical serialization is
    // JSON.stringify([0,pubkey,created_at,kind,tags,content]) with no
    // whitespace; JS JSON string-escaping matches NIP-01's required
    // escape set (\n \r \t \b \f \" \\, \u00XX for other <0x20),
    // which is exactly what nostr-tools and every signing client
    // emit — so a faithfully-signed event round-trips here.
    const serialized = JSON.stringify([
      0,
      pubkey,
      created_at,
      kind,
      tags,
      content,
    ]);
    const computedId = bytesToHex(sha256(utf8ToBytes(serialized)));
    if (computedId !== id) return false;

    // (4) BIP-340 Schnorr over the 32-byte id with the x-only pubkey.
    return schnorr.verify(hexToBytes(sig), hexToBytes(id), hexToBytes(pubkey));
  } catch {
    // Malformed hex, wrong-length bytes, library throw → untrusted.
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Relay query · last kind:1 event for a pubkey
// ─────────────────────────────────────────────────────────────────

/**
 * Returns the most recent `created_at` (unix seconds) of any kind:1
 * (text note) event from this pubkey across the supplied relays.
 *
 * Strategy: open a WebSocket to each relay in parallel · send a NIP-01
 * REQ filter for {authors: [pubkey], kinds: [1], limit: 1} · whichever
 * relays respond before the timeout contribute their event timestamps ·
 * we return the max.
 *
 * The racing pattern means the slowest relay doesn't gate the result.
 * Returns { lastActivityAt, reachable }. lastActivityAt is null when no
 * relay surfaced an event; `reachable` is false ONLY when every relay
 * failed/timed out · this lets the caller distinguish "no recent posts"
 * (definitive, a relay answered with EOSE) from "couldn't reach any
 * relay" (a transient outage that must NOT be read as dormancy).
 */
export async function fetchLastNostrActivity(
  pubkeyHex: string,
  relays: string[] = NOSTR_DEFAULT_RELAYS,
  timeoutMs = 5_000,
): Promise<{ lastActivityAt: number | null; reachable: boolean }> {
  const results = await Promise.allSettled(
    relays.map((url) => queryRelayForLastEvent(url, pubkeyHex, timeoutMs)),
  );
  // `reachable` flips true the moment ANY relay answers definitively
  // (an EVENT or an EOSE). If every relay only "failed", reachable stays
  // false and the caller must not infer silence · a relay outage is not
  // a dormant vendor (fail-open · see vendor-dormancy doctrine).
  let latest: number | null = null;
  let reachable = false;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const v = r.value;
    if (typeof v === "number") {
      reachable = true;
      if (latest === null || v > latest) latest = v;
    } else if (v === "empty") {
      reachable = true;
    }
    // "failed" · this relay couldn't answer; leave reachable unchanged.
  }
  return { lastActivityAt: latest, reachable };
}

function queryRelayForLastEvent(
  url: string,
  pubkeyHex: string,
  timeoutMs: number,
): Promise<number | "empty" | "failed"> {
  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket;
    const done = (v: number | "empty" | "failed") => {
      if (resolved) return;
      resolved = true;
      try {
        ws?.close();
      } catch {
        // socket may already be closed; ignore
      }
      resolve(v);
    };
    try {
      ws = new WebSocket(url);
    } catch {
      resolve("failed");
      return;
    }
    const subId = "audit-" + Math.random().toString(36).slice(2, 10);
    const timer = setTimeout(() => done("failed"), timeoutMs);
    ws.addEventListener("open", () => {
      // NIP-01 wire format · ["REQ", <subId>, <filter>, ...]
      ws.send(
        JSON.stringify([
          "REQ",
          subId,
          { authors: [pubkeyHex], kinds: [1], limit: 1 },
        ]),
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        // H9 (audit 2026-05) · pre-parse frame cap. A hostile or
        // permissive relay can stream a huge raw frame to force
        // JSON.parse plus the schnorr verify. The event.content cap
        // runs only AFTER the parse, so reject an oversized frame here,
        // BEFORE the parse. Same 4 KB bound and drop-not-truncate
        // stance as that content cap: over-cap frames are dropped and
        // we keep waiting (timeout or next message), the same fail-safe
        // as the catch below.
        if (typeof ev.data === "string" && ev.data.length > 4096) return;
        const data = JSON.parse(ev.data as string);
        if (Array.isArray(data) && data[0] === "EVENT" && data[1] === subId) {
          const event = data[2] as RawNostrEvent;
          // D1 · the relay is untrusted. Only a signature-verified
          // event from the queried pubkey may set the activity
          // timestamp — otherwise a hostile relay could fabricate
          // recent activity to keep a dead vendor visible, or
          // backdate an event to force a live vendor into dormancy.
          // H9 (audit 2026-05) · cheap structural + size checks run
          // BEFORE the schnorr verify, same ordering + 4 KB content
          // bound as queryRelayForRecentPosts, so a hostile relay
          // can't force verification work on oversized frames.
          // Dormancy only reads created_at; content isn't required,
          // so only an oversized STRING content is rejected.
          if (
            typeof event?.id === "string" &&
            typeof event?.created_at === "number" &&
            (typeof event.content !== "string" ||
              event.content.length <= 4096) &&
            verifyNostrEvent(event, pubkeyHex)
          ) {
            clearTimeout(timer);
            done(event.created_at);
            return;
          }
        }
        // EOSE = "end of stored events" · the relay answered
        // definitively that it has no more matches. That's a real
        // "no recent posts" signal (distinct from a relay that never
        // replied), so report "empty", not "failed".
        if (Array.isArray(data) && data[0] === "EOSE" && data[1] === subId) {
          clearTimeout(timer);
          done("empty");
        }
      } catch {
        // Not parseable JSON · keep waiting for a valid message or timeout.
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      done("failed");
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Recent posts · NIP-01 kind:1 events with content
// ─────────────────────────────────────────────────────────────────

/**
 * Single Nostr `kind:1` text-note event with the fields we display
 * on the vendor detail page. ID is the bech32-decodable hex; content
 * is the raw text (post-display content filter is the caller's
 * responsibility · see lib/nostr-content-filter.ts).
 */
export type RecentNostrPost = {
  id: string;        // hex event ID · for njump.me / primal.net deep-links
  content: string;   // raw kind:1 text content
  createdAt: number; // unix seconds
};

/**
 * Fetch the most-recent N kind:1 (text note) events from a pubkey
 * across the supplied relays. Same parallel-with-EOSE pattern as
 * fetchLastNostrActivity, but collects all events rather than just
 * the latest timestamp, and dedupes by event ID across relays.
 *
 * Returns newest-first, capped at `limit`. Empty array on total
 * failure (no events found, all relays timed out, etc.) · caller
 * decides whether to render the section or hide it.
 *
 * Use case: vendor detail page renders 3-5 recent posts as a
 * "what they're saying" surface. Caller fetches more than needed
 * (e.g. limit=10) so the content filter can drop spammy posts and
 * still have backups to display.
 */
export async function fetchRecentNostrPosts(
  pubkeyHex: string,
  limit = 10,
  relays: string[] = NOSTR_DEFAULT_RELAYS,
  timeoutMs = 5_000,
): Promise<RecentNostrPost[]> {
  const results = await Promise.allSettled(
    relays.map((url) =>
      queryRelayForRecentPosts(url, pubkeyHex, limit, timeoutMs),
    ),
  );
  // Dedupe by event ID across relays; same event may arrive from
  // multiple relays. First-seen wins (createdAt is identical anyway).
  const byId = new Map<string, RecentNostrPost>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const post of r.value) {
      if (!byId.has(post.id)) byId.set(post.id, post);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

function queryRelayForRecentPosts(
  url: string,
  pubkeyHex: string,
  limit: number,
  timeoutMs: number,
): Promise<RecentNostrPost[]> {
  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket;
    const collected: RecentNostrPost[] = [];
    const done = () => {
      if (resolved) return;
      resolved = true;
      try {
        ws?.close();
      } catch {
        // socket may already be closed
      }
      resolve(collected);
    };
    try {
      ws = new WebSocket(url);
    } catch {
      resolve([]);
      return;
    }
    const subId = "posts-" + Math.random().toString(36).slice(2, 10);
    const timer = setTimeout(done, timeoutMs);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify([
          "REQ",
          subId,
          { authors: [pubkeyHex], kinds: [1], limit },
        ]),
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        // H9 (audit 2026-05) · pre-parse frame cap. A hostile or
        // permissive relay can stream a huge raw frame to force
        // JSON.parse plus the schnorr verify. The event.content cap
        // runs only AFTER the parse, so reject an oversized frame here,
        // BEFORE the parse. Same 4 KB bound and drop-not-truncate
        // stance as that content cap: over-cap frames are dropped and
        // we keep waiting (timeout or next message), the same fail-safe
        // as the catch below.
        if (typeof ev.data === "string" && ev.data.length > 4096) return;
        const data = JSON.parse(ev.data as string);
        if (Array.isArray(data) && data[0] === "EVENT" && data[1] === subId) {
          const event = data[2] as RawNostrEvent;
          if (
            typeof event?.id === "string" &&
            typeof event?.content === "string" &&
            typeof event?.created_at === "number" &&
            // H9 (audit 2026-05): hard size + count caps BEFORE push.
            // A hostile/permissive relay (the responding host is
            // attacker-influenced for NIP-05/LNURL-shaped handles, and
            // relays don't all verify sigs) can stream many huge
            // EVENT frames; the downstream display filter only rejects
            // content >500 chars AFTER it's parsed + buffered, so the
            // memory pressure lands pre-filter. 4 KB is 8× the 500-char
            // display cap (ample headroom for legit posts) and bounds
            // worst-case buffer to limit×4KB. Frames over cap are
            // dropped, not truncated (truncation could change meaning).
            event.content.length <= 4096 &&
            collected.length < limit &&
            // D1 (audit 2026-05): drop anything not BIP-340 signed by
            // the queried vendor. Deliberately the LAST clause — the
            // cheap H9 size/count rejects run first so a hostile relay
            // can't make us schnorr-verify oversized frames (the
            // verify is the only non-trivial-cost check here).
            verifyNostrEvent(event, pubkeyHex)
          ) {
            collected.push({
              id: event.id,
              content: event.content,
              createdAt: event.created_at,
            });
          }
        }
        if (Array.isArray(data) && data[0] === "EOSE" && data[1] === subId) {
          clearTimeout(timer);
          done();
        }
      } catch {
        // Not parseable JSON · keep waiting
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      done();
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Profile metadata · NIP-01 kind:0 events
// ─────────────────────────────────────────────────────────────────

/**
 * NIP-01 kind:0 profile metadata as published by the vendor on
 * Nostr. Subset of what most clients populate · we only use the
 * fields that map to vendor-onboarding fields. All optional because
 * vendors' profile completeness varies wildly.
 */
export type NostrProfile = {
  // Display name (NIP-01 spec field, not always set)
  name?: string;
  // More-friendly display name (informal field many clients use)
  display_name?: string;
  // Short bio · maps well to vendor.description as a starting point
  about?: string;
  // Profile picture URL
  picture?: string;
  // Lightning Address (NIP-57 zaps) · maps to vendor.lightningAddress
  lud16?: string;
  // NIP-05 verification address (`name@domain.tld`)
  nip05?: string;
  // Personal/business website · maps to vendor.website
  website?: string;
  // Banner image · captured for completeness, not used by vendor schema
  banner?: string;
};

/**
 * Fetch the most recent kind:0 (profile metadata) event for a
 * pubkey across the supplied relays. Used by the onboarding CLI
 * to auto-suggest description, Lightning Address, NIP-05, and
 * website from the vendor's existing Nostr profile.
 *
 * Returns null if no relay returned a parseable kind:0 event.
 * The parser tolerates malformed JSON in the event content (some
 * older clients wrote non-standard formats) by returning null
 * instead of throwing.
 */
export async function fetchNostrProfileMetadata(
  pubkeyHex: string,
  relays: string[] = NOSTR_DEFAULT_RELAYS,
  timeoutMs = 5_000,
): Promise<NostrProfile | null> {
  const results = await Promise.allSettled(
    relays.map((url) => queryRelayForKind0(url, pubkeyHex, timeoutMs)),
  );
  // Pick the most recent valid profile across all relays · profile
  // events are mutable (NIP-01 says clients should use the latest
  // kind:0 by created_at).
  let latest: { createdAt: number; profile: NostrProfile } | null = null;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      if (latest === null || r.value.createdAt > latest.createdAt) {
        latest = r.value;
      }
    }
  }
  return latest?.profile ?? null;
}

function queryRelayForKind0(
  url: string,
  pubkeyHex: string,
  timeoutMs: number,
): Promise<{ createdAt: number; profile: NostrProfile } | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket;
    const done = (v: { createdAt: number; profile: NostrProfile } | null) => {
      if (resolved) return;
      resolved = true;
      try {
        ws?.close();
      } catch {
        // socket may already be closed
      }
      resolve(v);
    };
    try {
      ws = new WebSocket(url);
    } catch {
      resolve(null);
      return;
    }
    const subId = "profile-" + Math.random().toString(36).slice(2, 10);
    const timer = setTimeout(() => done(null), timeoutMs);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify([
          "REQ",
          subId,
          { authors: [pubkeyHex], kinds: [0], limit: 1 },
        ]),
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        // H9 (audit 2026-05) · pre-parse frame cap. A hostile or
        // permissive relay can stream a huge raw frame to force
        // JSON.parse plus the schnorr verify. The event.content cap
        // runs only AFTER the parse, so reject an oversized frame here,
        // BEFORE the parse. Same 4 KB bound and drop-not-truncate
        // stance as that content cap: over-cap frames are dropped and
        // we keep waiting (timeout or next message), the same fail-safe
        // as the catch below.
        if (typeof ev.data === "string" && ev.data.length > 4096) return;
        const data = JSON.parse(ev.data as string);
        if (Array.isArray(data) && data[0] === "EVENT" && data[1] === subId) {
          const event = data[2] as RawNostrEvent;
          // D1 · kind:0 metadata feeds vendor enrichment (picture /
          // website / lud16). Verify the signature before trusting a
          // profile, else a hostile relay could inject
          // attacker-controlled enrichment fields attributed to the
          // vendor.
          // H9 (audit 2026-05) · cheap structural + size checks run
          // BEFORE the schnorr verify, same ordering + 4 KB content
          // bound as queryRelayForRecentPosts, so a hostile relay
          // can't force verification work on oversized frames.
          if (
            typeof event?.id === "string" &&
            typeof event?.content === "string" &&
            event.content.length <= 4096 &&
            verifyNostrEvent(event, pubkeyHex)
          ) {
            try {
              const profile = JSON.parse(event.content) as NostrProfile;
              clearTimeout(timer);
              done({
                createdAt:
                  typeof event.created_at === "number"
                    ? event.created_at
                    : 0,
                profile,
              });
              return;
            } catch {
              // Malformed content JSON · keep waiting in case
              // another EVENT arrives with valid metadata.
            }
          }
        }
        if (Array.isArray(data) && data[0] === "EOSE" && data[1] === subId) {
          clearTimeout(timer);
          done(null);
        }
      } catch {
        // Not JSON · ignore until timeout.
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      done(null);
    });
  });
}
