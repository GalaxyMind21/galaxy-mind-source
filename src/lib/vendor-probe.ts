/**
 * vendor-probe · the I/O half of continuous monitoring.
 *
 * SECURITY: every URL here is user-submitted (vendors supply `website` on
 * the public submit form), so every request goes through safeFetch, which
 * re-validates each redirect hop. A bare fetch would validate hop 0 and
 * then happily follow a 302 to loopback or the cloud metadata IP.
 */
import { safeFetch } from "@/lib/safe-fetch";
import { vendorKey, type Vendor } from "@/lib/vendors";
import {
  decodeNostrBech32ToPubkey,
  fetchLastNostrActivity,
  fetchNostrProfileMetadata,
  resolveNip05,
} from "@/lib/nostr-activity";
import {
  extractPaymentMarkers,
  type PaymentMarkers,
  type ProbeOutcome,
  type VendorSignals,
} from "@/lib/vendor-signals";

const UA =
  "Mozilla/5.0 (compatible; GalaxyMindMonitor/1.0; +https://galaxymind.space/methodology)";

/**
 * Cap the body we read. `readCappedBody` stops pulling from the response
 * stream — and cancels the rest — the moment this many bytes have
 * accumulated, so a 50MB page is never buffered into memory in the first
 * place; the cap bounds what we HOLD, not just what we later decode.
 */
const MAX_BODY_BYTES = 512_000;

/** A profile/shop `ok` outcome with no page body to extract markers from. */
const NO_MARKERS: PaymentMarkers = { bitcoin: false, lightning: false, btc: false };

/**
 * The single most consequential function in this feature.
 *
 * 4xx that means "not here" is `gone`. 403/429 mean "not to you" and 503
 * means "not right now" (maintenance, not death) — those two, plus 408
 * (request timeout), are `unprobeable`, which never queues and never
 * counts against a vendor. Other 5xx (500/502/504) are NOT treated as
 * transient — they fall through to `gone` alongside ordinary 4xx.
 * Measured 2026-08-13: of four apparently-dead shops in a manual sweep,
 * three were alive; two were transient and one was blocking the probe's
 * network path.
 */
export function classifyResponse(
  res: Response | null,
  body: string | null,
  truncated = false,
): ProbeOutcome {
  if (res == null) return { kind: "unprobeable", reason: "fetch failed" };
  const s = res.status;
  if (s === 403 || s === 429 || s === 503 || s === 408) {
    return { kind: "unprobeable", reason: `status ${s}` };
  }
  if (s >= 400) return { kind: "gone", status: s };
  return { kind: "ok", markers: extractPaymentMarkers(body ?? ""), truncated };
}

/**
 * Maps a bech32 (`npub1…` / `nprofile1…`) vendor's relay-activity probe
 * onto the ProbeOutcome trichotomy. Pure — no network — so the policy is
 * directly testable without mocking a relay.
 *
 * Nostr accounts do not "go away": there is no server that can 404 an
 * identity, only relays that may or may not currently have anything to
 * say about it. `reachable: false` means every queried relay failed or
 * timed out — a relay outage, not evidence about the vendor — so it MUST
 * map to `unprobeable`, never `gone`. `reachable: true` covers both "we
 * found a recent note" and "a relay definitively answered EOSE, nothing
 * here" (see fetchLastNostrActivity's own doc comment); either way a
 * relay ANSWERED, which is the only kind of evidence this probe can ever
 * produce, so both map to `ok`. Silence is dormancy, never death — do
 * NOT "improve" this into a lastActivityAt-age check that emits `gone`
 * on an old timestamp; that would ratchet quiet-but-alive vendors into
 * the review queue permanently, which is exactly the failure mode this
 * feature exists to prevent.
 */
export function classifyNostrActivity(activity: {
  reachable: boolean;
  lastActivityAt: number | null;
}): ProbeOutcome {
  if (!activity.reachable) {
    return { kind: "unprobeable", reason: "no relay could be reached" };
  }
  return { kind: "ok", markers: NO_MARKERS };
}

/**
 * Maps a NIP-05 (`name@domain`) vendor's domain resolution onto the
 * ProbeOutcome trichotomy. Pure — no network.
 *
 * DIVERGENCE FROM THE FINDINGS DOC, noted deliberately rather than
 * silently: the spec's table asks for "definitively resolves to a
 * DIFFERENT pubkey, or a definitive negative" to map to `gone`, distinct
 * from a "transient fetch failure" mapping to `unprobeable`. But
 * `resolveNip05` (src/lib/nostr-activity.ts) collapses EVERY failure
 * mode — DNS failure, HTTP failure, JSON parse failure, AND "the domain
 * answered fine but has no entry for this name" — into the same `null`
 * return; nothing in its return value lets a caller tell "the domain
 * disowned this identity" apart from "the domain didn't answer tonight".
 * Given that ambiguity, and the standing rule that this feature must
 * never conclude a merchant stopped accepting bitcoin on shaky evidence,
 * `null` maps to `unprobeable` here, not `gone` — the safe default when
 * we can't tell why. The one case we CAN read with confidence is a
 * successful resolution that names a pubkey different from the one
 * already pinned at listing time (`vendor.nostrPubkey`): that is a
 * genuine "the domain now vouches for someone else" signal, so it's the
 * only path that reaches `gone`. When no pubkey was pinned (true for
 * most NIP-05 vendors today — see task-2-report.md), a successful
 * resolution to ANY pubkey is `ok`: we have no expectation to violate.
 */
export function classifyNip05Resolution(input: {
  resolvedPubkey: string | null;
  expectedPubkey: string | null;
}): ProbeOutcome {
  const { resolvedPubkey, expectedPubkey } = input;
  if (resolvedPubkey === null) {
    return {
      kind: "unprobeable",
      reason: "NIP-05 lookup failed, timed out, or has no entry for this name",
    };
  }
  if (
    expectedPubkey &&
    resolvedPubkey.toLowerCase() !== expectedPubkey.toLowerCase()
  ) {
    // No HTTP status applies to an identity-mismatch verdict — 0 is a
    // deliberate sentinel, never a wire status this branch could produce.
    return { kind: "gone", status: 0 };
  }
  return { kind: "ok", markers: NO_MARKERS };
}

/**
 * Read a Response body as a stream, stopping — and cancelling whatever is
 * left — the instant `maxBytes` have accumulated, then decode only that.
 *
 * `res.arrayBuffer()` fully buffers the ENTIRE response before any
 * `.slice()` can run, so a cap applied afterward only limits how much we
 * decode, not how much memory a single fetch can consume while it's in
 * flight. These are user-submitted vendor domains (SECURITY, see file
 * header) and `probeAll`'s concurrency=8 fires up to two fetches per
 * vendor, so that was ~16 simultaneous unbounded reads. Streaming and
 * cancelling early is what actually bounds memory, not just output size.
 *
 * Also reports whether the read was actually cut short. Two live shops
 * already exceed `MAX_BODY_BYTES` (612KB, 910KB); a marker that lives
 * past the cap on one run and not the other is a truncation artifact,
 * not a change on the merchant's page — callers use `truncated` to
 * suppress that false signal (see `diffSignals`'s payment-marker check).
 */
export async function readCappedBody(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const stream = res.body;
  if (!stream) {
    // No streaming body exposed (some runtimes/mocks lack one) — fall
    // back to a full read. Still correct, just not memory-bounded; none
    // of our real fetch responses take this path.
    const buf = await res.arrayBuffer();
    return {
      text: new TextDecoder().decode(buf.slice(0, maxBytes)),
      truncated: buf.byteLength > maxBytes,
    };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    const remaining = maxBytes - total;
    if (value.length > remaining) {
      // This chunk alone carried more real bytes than we kept: whatever
      // we're dropping here definitely existed on the wire.
      chunks.push(value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  if (!truncated && total >= maxBytes) {
    // Landed exactly on the cap without ever cutting a chunk mid-way —
    // that alone doesn't say whether the response ended right there or
    // simply had more after. One more read (never counted, never kept)
    // tells them apart.
    const peek = await reader.read();
    if (!peek.done && peek.value && peek.value.length > 0) truncated = true;
  }
  // Whether we hit the cap or the stream ended on its own, tell the
  // underlying source we're done reading. On an oversized response this
  // is what actually stops the rest of the body from continuing to
  // arrive over the wire instead of just being ignored locally.
  await reader.cancel().catch(() => {});
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  return { text: new TextDecoder().decode(combined), truncated };
}

async function probeUrl(url: string): Promise<ProbeOutcome> {
  const res = await safeFetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
  });
  if (res == null) return classifyResponse(null, null);
  let body: string | null = null;
  let truncated = false;
  try {
    const read = await readCappedBody(res, MAX_BODY_BYTES);
    body = read.text;
    truncated = read.truncated;
  } catch {
    body = "";
  }
  return classifyResponse(res, body, truncated);
}

type NostrProfileProbe = {
  outcome: ProbeOutcome;
  pubkeyHex: string | null;
};

/**
 * Nostr-platform profile probe. Branches on handle shape exactly like the
 * rest of the codebase does (add-vendor.ts, submit-vendor route,
 * nostr-activity.ts itself): bech32 handles go through relay activity,
 * NIP-05 handles go through domain resolution. Each branch's network
 * result is immediately handed to its pure classifier above, so the
 * ONLY judgment call lives in a directly-testable function.
 *
 * `pubkeyHex` rides along so the kind:0 lud16 read can reuse tonight's
 * resolution instead of looking the identity up a second time.
 */
async function probeNostrProfile(v: Vendor): Promise<NostrProfileProbe> {
  const handle = v.handle;
  if (handle.startsWith("npub1") || handle.startsWith("nprofile1")) {
    const pubkey = decodeNostrBech32ToPubkey(handle);
    if (!pubkey) {
      return {
        outcome: { kind: "unprobeable", reason: "could not decode bech32 handle" },
        pubkeyHex: null,
      };
    }
    const activity = await fetchLastNostrActivity(pubkey);
    return { outcome: classifyNostrActivity(activity), pubkeyHex: pubkey };
  }
  if (handle.includes("@")) {
    const resolvedPubkey = await resolveNip05(handle);
    // vendor.nostrPubkey is the pinned-at-listing-time identity anchor
    // (bech32 form) when one was recorded — see the classifyNip05Resolution
    // doc comment for why most NIP-05 vendors don't have one yet.
    const expectedPubkey = v.nostrPubkey
      ? decodeNostrBech32ToPubkey(v.nostrPubkey)
      : null;
    return {
      outcome: classifyNip05Resolution({ resolvedPubkey, expectedPubkey }),
      pubkeyHex: resolvedPubkey,
    };
  }
  return {
    outcome: { kind: "unprobeable", reason: "unrecognized Nostr handle format" },
    pubkeyHex: null,
  };
}

/**
 * Map a kind:0 fetch onto the lud16 we store tonight.
 *
 * `signedProfile == null` is fetch failure (or we never tried): keep
 * the listed address so a missed relay cannot look like drift-to-null.
 * A successful profile with a missing/blank lud16 stores null — that
 * is a real observation, not a probe miss.
 */
export function lud16FromSignedProfile(
  listed: string | null,
  signedProfile: { lud16?: string } | null,
): string | null {
  if (signedProfile == null) return listed ?? null;
  const raw = signedProfile.lud16;
  if (typeof raw !== "string") return null;
  const live = raw.trim();
  return live.length > 0 ? live : null;
}

/**
 * Pubkey we can use for the kind:0 read WITHOUT waiting on tonight's
 * NIP-05 / relay activity probe. Bech32 handles decode locally; NIP-05
 * vendors that had a pubkey pinned at listing time use that. Everyone
 * else waits on `probeNostrProfile`'s resolution.
 */
function pubkeyHexForKind0(v: Vendor): string | null {
  const handle = v.handle;
  if (handle.startsWith("npub1") || handle.startsWith("nprofile1")) {
    return decodeNostrBech32ToPubkey(handle);
  }
  if (v.nostrPubkey) return decodeNostrBech32ToPubkey(v.nostrPubkey);
  return null;
}

type FetchNostrProfile = (
  pubkeyHex: string,
) => Promise<{ lud16?: string } | null>;

export async function probeVendor(
  v: Vendor,
  now: number,
  fetchProfile: FetchNostrProfile = fetchNostrProfileMetadata,
): Promise<VendorSignals> {
  const website = v.website ?? null;
  const platform = v.platform ?? "x";
  const listedLud16 = v.lightningAddress ?? null;

  const shopPromise: Promise<ProbeOutcome | null> = website
    ? probeUrl(website)
    : Promise.resolve(null);

  if (platform === "nostr") {
    // Kind:0 rides the existing nostr path (not the X/Lightning
    // branches) so unit tests that never construct a nostr vendor
    // still never touch a relay. Bech32 / pinned-pubkey vendors
    // fetch it in parallel with the liveness probe; NIP-05 without
    // a pinned key waits on tonight's resolution, then fetches.
    const knownPub = pubkeyHexForKind0(v);
    const nostrP = probeNostrProfile(v);
    const kind0P: Promise<{ lud16?: string } | null> = knownPub
      ? fetchProfile(knownPub).catch(() => null)
      : nostrP.then((n) =>
          n.pubkeyHex ? fetchProfile(n.pubkeyHex).catch(() => null) : null,
        );
    const [shop, nostr, signed] = await Promise.all([
      shopPromise,
      nostrP,
      kind0P,
    ]);
    return {
      handle: v.handle,
      key: vendorKey(v),
      observedAt: now,
      shop,
      profile: nostr.outcome,
      lud16: lud16FromSignedProfile(listedLud16, signed),
      failStreak: 0, // recomputed against the baseline by the caller
    };
  }

  const profilePromise: Promise<ProbeOutcome | null> =
    platform === "x"
      ? probeUrl(`https://x.com/${encodeURIComponent(v.handle)}`)
      : Promise.resolve(null);

  const [shop, profile] = await Promise.all([shopPromise, profilePromise]);

  return {
    handle: v.handle,
    key: vendorKey(v),
    observedAt: now,
    shop,
    profile,
    // Non-Nostr: listed value only. There is no signature-verified
    // kind:0 to read for an X or Lightning identity.
    lud16: listedLud16,
    failStreak: 0, // recomputed against the baseline by the caller
  };
}

/** Bounded fan-out so a nightly sweep of ~130 hosts stays a polite citizen. */
export async function probeAll(
  vendors: Vendor[],
  now: number,
  concurrency = 8,
): Promise<VendorSignals[]> {
  const queue = [...vendors];
  const out: VendorSignals[] = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const v = queue.shift();
        if (!v) return;
        out.push(await probeVendor(v, now));
      }
    }),
  );
  return out;
}
