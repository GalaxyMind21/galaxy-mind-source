/**
 * classifyResponse is the whole risk surface of the probe layer: it is
 * where "the site is blocking me" gets separated from "the site is gone".
 * Getting that wrong queues healthy merchants, so it is tested directly
 * with synthetic Responses rather than over the network.
 *
 * classifyNostrActivity and classifyNip05Resolution carry the same kind
 * of risk for Nostr vendors, and readCappedBody carries the memory-safety
 * risk for the shop/profile fetch — all three are pure enough to test
 * without a live fetch or a relay, so they're covered directly too.
 */
import {
  classifyNip05Resolution,
  classifyNostrActivity,
  classifyResponse,
  lud16FromSignedProfile,
  probeVendor,
  readCappedBody,
} from "../src/lib/vendor-probe";
import { diffSignals, shouldQueue, type VendorSignals } from "../src/lib/vendor-signals";
import type { Vendor } from "../src/lib/vendors";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}

const res = (status: number) => new Response("", { status });

assert("200 with markers is ok", (() => {
  const o = classifyResponse(res(200), "<p>we take bitcoin</p>");
  return o.kind === "ok" && o.markers.bitcoin;
})());
assert("truncated is false by default", (() => {
  const o = classifyResponse(res(200), "<p>we take bitcoin</p>");
  return o.kind === "ok" && o.truncated === false;
})());
assert("truncated passes through when the read was cut short", (() => {
  const o = classifyResponse(res(200), "<p>we take bitcoin</p>", true);
  return o.kind === "ok" && o.truncated === true;
})());

assert("404 is gone", classifyResponse(res(404), "").kind === "gone");
assert("410 is gone", classifyResponse(res(410), "").kind === "gone");
assert("500 is gone", classifyResponse(res(500), "").kind === "gone");

assert("403 is unprobeable, NOT gone", classifyResponse(res(403), "").kind === "unprobeable");
assert("429 is unprobeable, NOT gone", classifyResponse(res(429), "").kind === "unprobeable");
assert("503 is unprobeable (maintenance, not death)", classifyResponse(res(503), "").kind === "unprobeable");
assert("408 is unprobeable", classifyResponse(res(408), "").kind === "unprobeable");
assert("null response (safeFetch refused or threw) is unprobeable",
  classifyResponse(null, null).kind === "unprobeable");

// ── classifyNostrActivity · relay silence must never mean "gone" ──────────

assert(
  "relay activity found is ok",
  classifyNostrActivity({ reachable: true, lastActivityAt: 1_700_000_000 }).kind === "ok",
);
assert(
  "relay EOSE with no notes (reachable, no activity) is ok, NOT gone",
  classifyNostrActivity({ reachable: true, lastActivityAt: null }).kind === "ok",
);
assert(
  "every relay unreachable is unprobeable, NEVER gone",
  classifyNostrActivity({ reachable: false, lastActivityAt: null }).kind === "unprobeable",
);

// ── classifyNip05Resolution ────────────────────────────────────────────

const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);

assert(
  "NIP-05 resolving to the expected pubkey is ok",
  classifyNip05Resolution({ resolvedPubkey: PK_A, expectedPubkey: PK_A }).kind === "ok",
);
assert(
  "NIP-05 resolving to the expected pubkey is case-insensitive",
  classifyNip05Resolution({ resolvedPubkey: PK_A.toUpperCase(), expectedPubkey: PK_A }).kind === "ok",
);
assert(
  "NIP-05 resolving to a DIFFERENT pinned pubkey is gone",
  classifyNip05Resolution({ resolvedPubkey: PK_B, expectedPubkey: PK_A }).kind === "gone",
);
assert(
  "NIP-05 resolving to any pubkey with no pinned expectation is ok",
  classifyNip05Resolution({ resolvedPubkey: PK_A, expectedPubkey: null }).kind === "ok",
);
assert(
  "NIP-05 lookup failure (null) is unprobeable, NEVER gone",
  classifyNip05Resolution({ resolvedPubkey: null, expectedPubkey: PK_A }).kind === "unprobeable",
);
assert(
  "NIP-05 lookup failure with no pinned expectation is unprobeable",
  classifyNip05Resolution({ resolvedPubkey: null, expectedPubkey: null }).kind === "unprobeable",
);

// ── lud16FromSignedProfile · fetch miss must never look like drift-to-null ──

assert(
  "kind:0 fetch failure keeps the listed address",
  lud16FromSignedProfile("listed@walletofsatoshi.com", null) ===
    "listed@walletofsatoshi.com",
);
assert(
  "kind:0 fetch failure with nothing listed stays null",
  lud16FromSignedProfile(null, null) === null,
);
assert(
  "successful kind:0 with a lud16 stores the trimmed live value",
  lud16FromSignedProfile("listed@x.com", { lud16: "  live@y.com  " }) ===
    "live@y.com",
);
assert(
  "successful kind:0 with an empty lud16 stores null",
  lud16FromSignedProfile("listed@x.com", { lud16: "   " }) === null,
);
assert(
  "successful kind:0 with no lud16 field stores null",
  lud16FromSignedProfile("listed@x.com", {}) === null,
);

{
  const listed = "listed@x.com";
  const night1: VendorSignals = {
    handle: "npub1acme",
    observedAt: 1,
    shop: null,
    profile: { kind: "ok", markers: { bitcoin: false, lightning: false, btc: false } },
    lud16: lud16FromSignedProfile(listed, { lud16: listed }),
    failStreak: 0,
  };
  const nightLive = {
    ...night1,
    lud16: lud16FromSignedProfile(listed, { lud16: "attacker@evil.com" }),
  };
  const nightMiss = {
    ...night1,
    lud16: lud16FromSignedProfile(listed, null),
  };
  assert(
    "a live kind:0 change across nights is lud16-drift",
    diffSignals(night1, nightLive).some((c) => c.type === "lud16-drift"),
  );
  assert(
    "that live change queues at high priority",
    shouldQueue(diffSignals(night1, nightLive), 0).priority === "high",
  );
  assert(
    "a failed kind:0 fetch against the same listed value is NOT drift",
    diffSignals(night1, nightMiss).length === 0,
  );
}

// ── readCappedBody · the cap must bound what is READ, not just decoded ──

async function main() {
  const enc = new TextEncoder();

  // Body under the cap comes back whole, untruncated.
  {
    const body = new Response("hello world");
    const out = await readCappedBody(body, 1000);
    assert("under-cap body is returned in full", out.text === "hello world");
    assert("under-cap body reports truncated: false", out.truncated === false);
  }

  // Body over the cap is truncated to EXACTLY maxBytes, and the stream is
  // cancelled rather than drained to completion — proven by feeding chunks
  // from a `pull`-based source that only produces on demand: if a third
  // chunk were ever requested, the cap failed to stop consumption.
  {
    let canceled = false;
    let chunkIndex = 0;
    const chunkBytes = [enc.encode("A".repeat(6)), enc.encode("B".repeat(6)), enc.encode("C".repeat(6))];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunkIndex < chunkBytes.length) {
          controller.enqueue(chunkBytes[chunkIndex]);
          chunkIndex++;
        } else {
          controller.close();
        }
      },
      cancel() {
        canceled = true;
      },
    });
    const body = new Response(stream);
    const out = await readCappedBody(body, 10);
    assert("over-cap body is truncated to exactly maxBytes", out.text === "AAAAAABBBB");
    assert("over-cap body cancels the remainder of the stream", canceled);
    assert("mid-chunk cut reports truncated: true", out.truncated === true);
  }

  // Body that lands EXACTLY on the cap on a chunk boundary, with more
  // data still behind it — the case a naive "did we cut a chunk mid-way"
  // check would miss, since nothing was ever sliced.
  {
    let chunkIndex = 0;
    const chunkBytes = [enc.encode("A".repeat(5)), enc.encode("B".repeat(5)), enc.encode("C".repeat(5))];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunkIndex < chunkBytes.length) {
          controller.enqueue(chunkBytes[chunkIndex]);
          chunkIndex++;
        } else {
          controller.close();
        }
      },
    });
    const body = new Response(stream);
    const out = await readCappedBody(body, 10);
    assert("boundary-exact cap still returns exactly maxBytes", out.text === "AAAAABBBBB");
    assert("boundary-exact cap with more data behind it is still truncated", out.truncated === true);
  }

  // Body that ends EXACTLY at the cap with nothing left behind it — the
  // one case that must NOT be reported as truncated.
  {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("A".repeat(10)));
        controller.close();
      },
    });
    const body = new Response(stream);
    const out = await readCappedBody(body, 10);
    assert("exact-length body at the cap is NOT truncated", out.truncated === false);
  }

  // probeVendor's extra kind:0 fetch is behind the nostr branch. A
  // Lightning vendor with no website never touches the network here
  // (no shop URL, no X profile, no relay), so a stub that throws if
  // called proves we do not fetch kind:0 for non-Nostr identities.
  {
    let fetched = false;
    const stub = async () => {
      fetched = true;
      return { lud16: "attacker@evil.com" };
    };
    const v: Vendor = {
      handle: "shop@example.com",
      platform: "lightning",
      name: "Example Shop",
      description: "test fixture",
      category: "books",
      addedAt: 1,
      listedAt: 1,
      verifiedAt: 1,
      lightningAddress: "listed@example.com",
    };
    const out = await probeVendor(v, 1_786_579_200, stub);
    assert("non-nostr vendors never fetch kind:0", !fetched);
    assert(
      "non-nostr vendors store the listed lightning address",
      out.lud16 === "listed@example.com",
    );
  }

  // Undecodable bech32: probeNostrProfile returns unprobeable locally
  // and never opens a relay. The kind:0 stub must also stay uncalled,
  // and the listed address must be kept.
  {
    let fetched = false;
    const stub = async () => {
      fetched = true;
      return { lud16: "attacker@evil.com" };
    };
    const v: Vendor = {
      handle: "npub1notarealkey",
      platform: "nostr",
      name: "Broken Bech32",
      description: "test fixture",
      category: "books",
      addedAt: 1,
      listedAt: 1,
      verifiedAt: 1,
      lightningAddress: "listed@example.com",
    };
    const out = await probeVendor(v, 1_786_579_200, stub);
    assert("undecodable nostr handle never fetches kind:0", !fetched);
    assert(
      "undecodable nostr handle keeps the listed lud16",
      out.lud16 === "listed@example.com",
    );
  }

  // Pinned listing-time pubkey + a handle that is neither bech32 nor
  // NIP-05: probeNostrProfile returns unprobeable locally (no relay),
  // while kind:0 still runs against the pinned key. That's the inject
  // seam — the stub is what would be a live signed profile in prod.
  {
    const base: Vendor = {
      handle: "not-bech32-or-nip05",
      platform: "nostr",
      name: "Pinned Key",
      description: "test fixture",
      category: "books",
      addedAt: 1,
      listedAt: 1,
      verifiedAt: 1,
      lightningAddress: "listed@example.com",
      nostrPubkey:
        "npub15ypxpg429uyjmp0zczuza902chuvvr4pn35wfzv8rx6cej4z8clq6jmpcx",
    };
    const live = await probeVendor(base, 1_786_579_200, async (hex) => {
      assert("kind:0 fetch is keyed by a 64-char hex pubkey", hex.length === 64);
      return { lud16: "  live@example.com  " };
    });
    assert(
      "successful kind:0 stores the live signed lud16, not the listed value",
      live.lud16 === "live@example.com",
    );
    const missed = await probeVendor(base, 1_786_579_200, async () => null);
    assert(
      "kind:0 fetch failure keeps the listed lud16",
      missed.lud16 === "listed@example.com",
    );
    const threw = await probeVendor(base, 1_786_579_200, async () => {
      throw new Error("relay down");
    });
    assert(
      "kind:0 throw keeps the listed lud16",
      threw.lud16 === "listed@example.com",
    );
    const blank = await probeVendor(base, 1_786_579_200, async () => ({
      lud16: "   ",
    }));
    assert(
      "successful kind:0 with blank lud16 stores null, not listed",
      blank.lud16 === null,
    );
  }

  console.log(`\n${passed} passed · ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
