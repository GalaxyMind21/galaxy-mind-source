// Test harness for verifyNostrEvent (lib/nostr-activity · audit
// 2026-05 D1). Deterministic + offline: we sign events with the same
// BIP-340 primitive a real client uses, over the EXACT NIP-01
// canonical serialization (JSON.stringify([0,pubkey,created_at,kind,
// tags,content])) that nostr-tools' getEventHash emits — so a
// passing round-trip proves cross-client compatibility, and the
// tamper/malformed cases prove the fail-safe rejects everything else.
//
// Run: npx tsx scripts/test-nostr-verify.ts

import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  randomBytes,
} from "@noble/hashes/utils.js";
import {
  verifyNostrEvent,
  pickNip05Name,
  type RawNostrEvent,
} from "../src/lib/nostr-activity";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

type SignOpts = {
  content?: string;
  created_at?: number;
  kind?: number;
  tags?: string[][];
};

function buildSignedEvent(opts: SignOpts = {}) {
  const sk = randomBytes(32);
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const created_at = opts.created_at ?? Math.floor(Date.now() / 1000);
  const kind = opts.kind ?? 1;
  const tags = opts.tags ?? [];
  const content = opts.content ?? "gm, stacking sats";
  const serialized = JSON.stringify([
    0,
    pubkey,
    created_at,
    kind,
    tags,
    content,
  ]);
  const id = bytesToHex(sha256(utf8ToBytes(serialized)));
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  const event: RawNostrEvent = {
    id,
    pubkey,
    created_at,
    kind,
    tags,
    content,
    sig,
  };
  return { event, pubkey };
}

function flipLastHex(s: string): string {
  const c = s[s.length - 1];
  return s.slice(0, -1) + (c === "0" ? "1" : "0");
}

console.log("verifyNostrEvent · signature verification\n");

// ── Positive: faithfully-signed events round-trip ──────────────────
{
  const { event, pubkey } = buildSignedEvent();
  check("valid kind:1 event verifies", verifyNostrEvent(event, pubkey));
}
{
  // Non-ASCII content exercises utf8ToBytes + NIP-01 escaping — the
  // one subtle place our serialization could diverge from clients'.
  const { event, pubkey } = buildSignedEvent({
    content: 'café ☕ — naïve 🚀 "quotes" \\back\\ \n newline \t tab',
  });
  check("valid event with UTF-8 / escapes verifies", verifyNostrEvent(event, pubkey));
}
{
  // kind:0-style: JSON profile content + tags present.
  const { event, pubkey } = buildSignedEvent({
    kind: 0,
    tags: [["alt", "profile"]],
    content: '{"name":"Soap Miner","website":"https://x.example"}',
  });
  check("valid kind:0 w/ tags verifies", verifyNostrEvent(event, pubkey));
}

// ── Negative: the relay-spoofing attack we're defending against ────
{
  // Perfectly signed — but by a DIFFERENT key than we queried. A
  // malicious relay can ignore the REQ authors filter. This is the
  // core D1 attack; signature validity alone must NOT be enough.
  const { event } = buildSignedEvent();
  const otherPubkey = bytesToHex(schnorr.getPublicKey(randomBytes(32)));
  check(
    "valid sig but wrong author → rejected",
    verifyNostrEvent(event, otherPubkey) === false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  const tampered = { ...event, content: event.content + " (edited by relay)" };
  check(
    "content tampered post-sign → rejected",
    verifyNostrEvent(tampered, pubkey) === false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  const tampered = { ...event, created_at: (event.created_at as number) - 86400 };
  check(
    "created_at tampered → rejected",
    verifyNostrEvent(tampered, pubkey) === false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  const tampered = { ...event, sig: flipLastHex(event.sig as string) };
  check(
    "signature bit-flipped → rejected",
    verifyNostrEvent(tampered, pubkey) === false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  const tampered = { ...event, id: flipLastHex(event.id as string) };
  check(
    "event id tampered → rejected",
    verifyNostrEvent(tampered, pubkey) === false,
  );
}

// ── Negative: malformed fields (fail-safe input validation) ────────
{
  const { event, pubkey } = buildSignedEvent();
  check(
    "uppercase-hex pubkey → rejected",
    verifyNostrEvent(
      { ...event, pubkey: (event.pubkey as string).toUpperCase() },
      pubkey,
    ) === false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  check(
    "short sig → rejected",
    verifyNostrEvent({ ...event, sig: "deadbeef" }, pubkey) === false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  check(
    "tags not an array → rejected",
    verifyNostrEvent(
      { ...event, tags: "not-an-array" } as RawNostrEvent,
      pubkey,
    ) === false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  check(
    "content not a string → rejected",
    verifyNostrEvent({ ...event, content: 123 } as RawNostrEvent, pubkey) ===
      false,
  );
}
{
  const { event, pubkey } = buildSignedEvent();
  const { sig: _omit, ...noSig } = event as Record<string, unknown>;
  void _omit;
  check(
    "missing sig → rejected",
    verifyNostrEvent(noSig as RawNostrEvent, pubkey) === false,
  );
}
{
  check(
    "empty object → rejected",
    verifyNostrEvent({}, "00".repeat(32)) === false,
  );
}

// ─────────────────────────────────────────────────────────────────
// NIP-05 name lookup · case-folding (2026-07-29)
//
// Regression guard for a real, silent failure found by
// scripts/nostr-starter-pack.ts: the vendor handle
// `Trails@trailscoffee.com` never resolved, because the lookup was an
// exact-case `names[name]` while the server keys that entry "trails".
// It broke that vendor's dormancy checks, recent-posts panel, and
// kind:0 enrichment with no error surfaced anywhere. Pure function, no
// network.
// ─────────────────────────────────────────────────────────────────
{
  const PK = "c2c2cda6f2dbc736da8542d1742067de91ae287e96c9695550ff37e0117d61f2";
  const names = { trails: PK, other: "deadbeef" };

  check("nip05: exact local part resolves", pickNip05Name(names, "trails") === PK);
  check(
    "nip05: capitalised local part resolves (the Trails Coffee bug)",
    pickNip05Name(names, "Trails") === PK,
  );
  check("nip05: all-caps local part resolves", pickNip05Name(names, "TRAILS") === PK);
  // Case-fold ONLY, never fuzzy · the same rule lib/ln-guard.ts follows.
  check(
    "nip05: lookalike is NOT a match (case-fold only, never fuzzy)",
    pickNip05Name(names, "trai1s") === null,
  );
  check(
    "nip05: whitespace is not trimmed into a match",
    pickNip05Name(names, "trails ") === null,
  );
  check("nip05: absent names map → null", pickNip05Name(undefined, "trails") === null);
  check(
    "nip05: empty pubkey value → null, not an empty string",
    pickNip05Name({ trails: "" }, "trails") === null,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log("✓ verifyNostrEvent fail-safe + round-trip all green");

