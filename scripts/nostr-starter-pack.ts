#!/usr/bin/env tsx
/**
 * nostr-starter-pack · build the paste-ready npub list for a Nostr
 * starter pack of every Nostr-platform merchant in the directory.
 *
 * Run via:
 *   npx tsx scripts/nostr-starter-pack.ts
 *   npx tsx scripts/nostr-starter-pack.ts --json
 *
 * WHY A SCRIPT AND NOT A CRON
 * ---------------------------
 * This deliberately does NOT publish. src/lib/nostr.ts is still a
 * documented STUB, and its header explains the trade: publishing
 * server-side means an nsec in Vercel env, which is a private key with
 * no revocation story sitting in an environment that many processes can
 * read, in exchange for automating something that happens a few times a
 * year. The operator publishes manually from their own client — exactly
 * the same call already made for X posting (the auto-post crons were
 * deleted 2026-05-13 in favour of a drafts email).
 *
 * So: this prints, you paste.
 *
 * WHY A STARTER PACK (kind 39089) AND NOT A FOLLOW SET (kind 30000)
 * ------------------------------------------------------------------
 * Both are "a list of npubs", but 39089 is the one Primal and Amethyst
 * surface with a prominent one-tap "follow all" affordance. A 30000
 * follow set is mostly a private organisational tool. For a directory
 * whose entire pitch is "here are real merchants you can buy from", the
 * discoverable one is the point.
 *
 * ALL 47 NOSTR VENDORS RESOLVE, not just the 42 bech32 ones:
 * resolveNostrHandleToPubkey() already handles the NIP-05 case by
 * fetching the vendor's /.well-known/nostr.json, and async work is free
 * in a CLI. Those 5 would be silently dropped by a naive bech32-only
 * decode.
 *
 * MAINTENANCE: the published pack goes stale as the roster grows and
 * there is NO drift guard for it (it lives on relays, not in this
 * repo). Re-run this after a batch of Nostr vendors lands and update
 * the pack from your client. This script is the source of truth for
 * what the pack SHOULD contain; the relay copy is a snapshot.
 */
import { VENDORS } from "../src/lib/vendors";
import { resolveNostrHandleToPubkey } from "../src/lib/nostr-resolve";

// ─────────────────────────────────────────────────────────────────
// bech32 ENCODE · local to this script on purpose.
//
// lib/nostr-activity.ts only ever needed to DECODE (and its decoder
// deliberately skips checksum verification — a relay event is
// signature-verified anyway, so the bech32 checksum adds nothing
// there). Encoding is different: an npub with a wrong checksum is
// rejected by every client, so the full polymod is mandatory here.
//
// Kept in this file rather than exported into src/ because nothing in
// the app needs it — the site displays vendor.name for bech32 handles,
// never a re-encoded npub. Shipping an encoder into the bundle for a
// CLI-only need would be dead weight.
//
// Correctness is not assumed: main() round-trips every npub-prefixed
// vendor handle (decode → encode → compare) and refuses to print if
// any fails. See BIP-173 for the algorithm.
// ─────────────────────────────────────────────────────────────────
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

/** 8-bit bytes → 5-bit groups, padding the tail (BIP-173 convertbits). */
function to5bit(bytes: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

function bech32Encode(hrp: string, data: number[]): string {
  const values = [...hrpExpand(hrp), ...data];
  const mod = polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return (
    hrp +
    "1" +
    [...data, ...checksum].map((d) => BECH32_CHARSET[d]).join("")
  );
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** hex pubkey → npub1… */
function encodeNpub(pubkeyHex: string): string {
  return bech32Encode("npub", to5bit(hexToBytes(pubkeyHex)));
}

const JSON_OUT = process.argv.includes("--json");

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

type Resolved = {
  name: string;
  handle: string;
  pubkey: string;
  npub: string;
};

/**
 * Prove the local encoder before trusting its output.
 *
 * Every npub-prefixed vendor handle is a known-good bech32 string, so
 * decode → re-encode must reproduce it byte for byte. A silent
 * checksum bug here would produce npubs that every client rejects,
 * and the operator would only find out after publishing the pack.
 * nprofile handles are skipped: they legitimately re-encode to a
 * DIFFERENT string (npub drops the relay hints).
 */
async function selfCheckEncoder(): Promise<string[]> {
  const { decodeNostrBech32ToPubkey } = await import(
    "../src/lib/nostr-activity"
  );
  const failures: string[] = [];
  for (const v of VENDORS) {
    if (!v.handle.startsWith("npub1")) continue;
    const hex = decodeNostrBech32ToPubkey(v.handle);
    if (!hex) {
      failures.push(`${v.handle} (decode returned null)`);
      continue;
    }
    const round = encodeNpub(hex);
    if (round !== v.handle) failures.push(`${v.handle} -> ${round}`);
  }
  return failures;
}

async function main() {
  const encoderFailures = await selfCheckEncoder();
  if (encoderFailures.length > 0) {
    console.error(
      `\nbech32 encoder self-check FAILED on ${encoderFailures.length} known-good npub(s):`,
    );
    for (const f of encoderFailures) console.error(`  ${f}`);
    console.error("\nRefusing to print a pack built with a broken encoder.");
    process.exit(1);
  }

  const nostrVendors = VENDORS.filter((v) => v.platform === "nostr");
  if (!JSON_OUT) {
    console.log();
    console.log(C.bold("Galaxy Mind · Nostr starter pack builder"));
    console.log(
      C.dim(`  resolving ${nostrVendors.length} Nostr vendors (NIP-05 lookups hit the network)...`),
    );
    console.log();
  }

  const resolved: Resolved[] = [];
  const failed: { name: string; handle: string }[] = [];

  // Sequential on purpose · NIP-05 resolution hits each vendor's own
  // domain, and a burst of parallel requests to 47 small self-hosted
  // sites is rude for no gain on a script that runs a few times a year.
  for (const v of nostrVendors) {
    const pubkey = await resolveNostrHandleToPubkey(v.handle).catch(() => null);
    if (!pubkey) {
      failed.push({ name: v.name, handle: v.handle });
      if (!JSON_OUT) console.log(`  ${C.warn} ${v.name} ${C.dim(`(${v.handle})`)}`);
      continue;
    }
    const npub = encodeNpub(pubkey);
    resolved.push({ name: v.name, handle: v.handle, pubkey, npub });
    if (!JSON_OUT) console.log(`  ${C.ok} ${v.name}`);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ resolved, failed }, null, 2));
    return;
  }

  console.log();
  console.log(
    `  ${resolved.length}/${nostrVendors.length} resolved` +
      (failed.length ? ` · ${failed.length} unresolved (listed above)` : ""),
  );
  console.log();
  console.log("─ Pack description (paste into your client) ─────────────────");
  console.log();
  console.log("Bitcoin merchants on Nostr");
  console.log();
  console.log(
    `${resolved.length} merchants who take bitcoin for everyday goods — apparel, hardware, coffee, books, services. Every one human-verified and re-checked on a 90-day window. Full directory, with countries and categories: https://galaxymind.space`,
  );
  console.log();
  console.log("─ npubs ─────────────────────────────────────────────────────");
  console.log();
  for (const r of resolved) console.log(r.npub);
  console.log();
  console.log(
    C.dim(
      "  Publish from your own client as a starter pack (kind 39089).\n" +
        "  Nothing here touches a private key · see the header for why.",
    ),
  );
  console.log();
}

main().catch((e) => {
  console.error("\nnostr-starter-pack failed:", e);
  process.exit(1);
});
