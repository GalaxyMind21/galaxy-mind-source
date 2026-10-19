// Minimal Nostr publisher.
//
// Status: STUB · the env-gating + interface is shipped, but actual
// signing requires a one-time package install. See "Setup" below.
//
// ────────────────────────────────────────────────────────────
// Why this exists separate from the X path:
// Nostr is decentralized · there's no API endpoint to POST to. You
// sign an event with your private key (nsec) and broadcast it to one
// or more relay websockets. Receivers verify the signature against
// your public key (npub).
//
// The signing math is secp256k1 + sha256 + canonical JSON. Node's
// built-in crypto module supports secp256k1 but the boilerplate is
// awkward. The cleanest path is to install one small package:
//
//   pnpm add @noble/secp256k1 nostr-tools
//
// Then replace the stub `signEvent` / `publishToRelays` calls below
// with the real implementations. The function signatures + envelope
// already match what nostr-tools expects, so the swap is one
// import-line change.
//
// ────────────────────────────────────────────────────────────
// Security model · NIP-26 delegation strongly recommended:
// Don't put your main npub's nsec in env vars. If Vercel ever leaks
// or someone gains read access to your project settings, they get
// FULL control of your Nostr identity (post, edit profile, follow
// scams, the works).
//
// Better: generate a delegated key with NIP-26 capability scope
// limited to "kind 1 notes only, expires in N months". Only the
// delegate's nsec sits in env; your real nsec stays in cold storage.
// If the delegate leaks, the worst attackers can do is post text
// notes from your identity for the delegation period · you can
// revoke and re-delegate.
//
// Setup instructions: see SOCIAL_AUTOMATION.md
//
// ────────────────────────────────────────────────────────────
// Required env vars (none currently set):
//   NOSTR_NSEC_HEX       — 64-char hex private key (NOT the bech32
//                          nsec1... form · convert with nostr-tools'
//                          nip19.decode())
//   NOSTR_RELAYS         — comma-separated websocket URLs. Default
//                          set used if not provided. Recommended:
//                          relay.damus.io, relay.primal.net,
//                          nos.lol, relay.snort.social
//   NOSTR_DELEGATION_TAG — optional NIP-26 delegation tag JSON
//                          string · attached to events so the
//                          relay/clients verify the delegate's
//                          authority

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

export type NostrPostResult =
  | { ok: true; eventId: string; relaysAccepted: number }
  | { ok: false; error: string };

export function isNostrConfigured(): boolean {
  return !!process.env.NOSTR_NSEC_HEX;
}

export function getNostrRelays(): string[] {
  const env = process.env.NOSTR_RELAYS;
  if (!env) return DEFAULT_RELAYS;
  return env
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("wss://"));
}

/**
 * Publish a kind:1 text note to the configured relays.
 *
 * STUB · returns an explicit "not implemented" error until the
 * @noble/secp256k1 + nostr-tools install lands. The /api/post-to-social
 * endpoint already gates on isNostrConfigured() so this stub is
 * never called when the env is set in production.
 *
 * To activate:
 *   1. pnpm add @noble/secp256k1 nostr-tools
 *   2. Replace this function body with:
 *
 *        import { finalizeEvent, getPublicKey, SimplePool } from "nostr-tools";
 *
 *        const sk = hexToBytes(process.env.NOSTR_NSEC_HEX!);
 *        const event = finalizeEvent(
 *          {
 *            kind: 1,
 *            created_at: Math.floor(Date.now() / 1000),
 *            tags: parseDelegationTag(process.env.NOSTR_DELEGATION_TAG),
 *            content: text,
 *          },
 *          sk,
 *        );
 *        const pool = new SimplePool();
 *        const accepts = await Promise.allSettled(
 *          pool.publish(getNostrRelays(), event),
 *        );
 *        const ok = accepts.filter(a => a.status === "fulfilled").length;
 *        return ok > 0
 *          ? { ok: true, eventId: event.id, relaysAccepted: ok }
 *          : { ok: false, error: "no relay accepted the event" };
 *
 *   3. Set NOSTR_NSEC_HEX in Vercel env (use a NIP-26 delegate, NOT
 *      your main nsec) and redeploy.
 */
export async function postNostrNote(_text: string): Promise<NostrPostResult> {
  if (!isNostrConfigured()) {
    return {
      ok: false,
      error: "NOSTR_NSEC_HEX not set · see SOCIAL_AUTOMATION.md for setup",
    };
  }
  return {
    ok: false,
    error:
      "Nostr publisher is a stub · install @noble/secp256k1 + nostr-tools and replace src/lib/nostr.ts:postNostrNote() body. See SOCIAL_AUTOMATION.md for the activation recipe.",
  };
}
