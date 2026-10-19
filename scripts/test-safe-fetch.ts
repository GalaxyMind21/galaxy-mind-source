// Test harness for the SSRF guard (lib/safe-fetch · audit 2026-08).
// Deterministic + offline: validateOutboundUrl is pure, and safeFetch
// is exercised against a stubbed global fetch so the redirect-chain
// invariants are provable without touching the network.
//
// Why this file exists: the guard had shipped for over a year with no
// test at all, and the 2026-08 pass found two ways past it —
//
//   1. TRAILING DOT · `https://localhost./` keeps its root label
//      through the WHATWG URL parser, so an exact-match blocklist and
//      an `.endsWith(".local")` suffix test both miss while the
//      resolver still routes to loopback. Reachable in prod through
//      POST /api/push/subscribe, which hands the guard a raw
//      client-supplied endpoint with no handle regex in front of it.
//   2. REDIRECT FOLLOWING · the validator only ever saw the URL the
//      caller BUILT. A bare fetch() defaults to redirect:"follow", so
//      an attacker-owned domain passed the guard and then 302'd the
//      server into loopback / the cloud metadata IP, with the guard
//      never running a second time.
//
// Both are pinned below. The pre-existing invariants (private ranges,
// octal/dword/hex IP obfuscation, IPv6, ports, scheme) are pinned too
// so a future "simplification" of the validator fails loudly.
//
// Run: npx tsx scripts/test-safe-fetch.ts

import {
  readCappedJson,
  safeFetch,
  validateOutboundUrl,
} from "../src/lib/safe-fetch";

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

const blocked = (u: string) => validateOutboundUrl(u).ok === false;
const allowed = (u: string) => validateOutboundUrl(u).ok === true;

// ---------------------------------------------------------------
console.log("\nvalidateOutboundUrl · trailing-dot normalization (2026-08)");
// ---------------------------------------------------------------
// The regression these four pin. Before the fix each was ok:true.
check("localhost. is blocked", blocked("https://localhost./x"));
check("localhost... is blocked", blocked("https://localhost.../x"));
check(
  "metadata.google.internal. is blocked",
  blocked("https://metadata.google.internal./computeMetadata/v1/"),
);
check("printer.local. is blocked", blocked("https://printer.local./"));
check("host of only dots is rejected", blocked("https://.../"));
// Normalization must not change the verdict for legitimate hosts —
// a trailing dot on a public name is valid DNS, not an attack.
check("example.com. still allowed", allowed("https://example.com./"));
check("plain public host still allowed", allowed("https://vendor.example/x"));
check("userinfo is blocked", blocked("https://user:pass@vendor.example/x"));
check("username-only userinfo is blocked", blocked("https://user@vendor.example/x"));

// ---------------------------------------------------------------
console.log("\nvalidateOutboundUrl · pre-existing invariants (must not regress)");
// ---------------------------------------------------------------
check("localhost blocked", blocked("https://localhost/"));
check("loopback quad blocked", blocked("https://127.0.0.1/"));
check("metadata IP blocked", blocked("https://169.254.169.254/"));
check("RFC1918 10/8 blocked", blocked("https://10.1.2.3/"));
check("RFC1918 192.168 blocked", blocked("https://192.168.1.1/"));
check("CGNAT 100.64 blocked", blocked("https://100.64.0.1/"));
check("dword IP blocked", blocked("https://2130706433/"));
check("octal IP blocked", blocked("https://0177.0.0.1/"));
check("hex IP blocked", blocked("https://0x7f.0.0.1/"));
check("short-form IP blocked", blocked("https://127.1/"));
check("IPv6 loopback blocked", blocked("https://[::1]/"));

// Security audit 2026-10-18 (L5): remaining IANA special-purpose IPv4 ranges.
check("192.0.0.0/24 blocked", blocked("https://192.0.0.8/"));
check("TEST-NET-1 blocked", blocked("https://192.0.2.10/"));
check("benchmarking 198.18/15 blocked", blocked("https://198.18.0.1/") && blocked("https://198.19.255.254/"));
check("TEST-NET-2 blocked", blocked("https://198.51.100.7/"));
check("TEST-NET-3 blocked", blocked("https://203.0.113.9/"));
check("multicast 224/4 blocked", blocked("https://224.0.0.251/") && blocked("https://239.255.255.250/"));
check("reserved 240/4 + broadcast blocked", blocked("https://240.0.0.1/") && blocked("https://255.255.255.255/"));
check("neighbours of the new ranges stay allowed", allowed("https://198.17.255.255/") && allowed("https://198.20.0.1/") && allowed("https://223.255.255.254/") && allowed("https://192.0.3.1/"));
check("non-443 port blocked", blocked("https://example.com:22/"));
check("http scheme blocked", blocked("http://example.com/"));
check("file scheme blocked", blocked("file:///etc/passwd"));
check("garbage URL blocked", blocked("not a url"));

// ---------------------------------------------------------------
console.log("\nsafeFetch · every redirect hop is re-validated (2026-08)");
// ---------------------------------------------------------------
const realFetch = globalThis.fetch;

/** Stub fetch with a scripted url -> response map. Records call order
 *  so we can assert a blocked hop was never actually requested. */
function stubFetch(routes: Record<string, { status: number; location?: string }>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    // The whole point of the fix: callers must pass redirect:"manual"
    // so undici hands the 3xx back instead of transparently following.
    if (init?.redirect !== "manual") {
      throw new Error(`safeFetch must set redirect:"manual" (got ${init?.redirect})`);
    }
    const r = routes[url];
    if (!r) throw new Error(`unstubbed url: ${url}`);
    const headers = new Headers();
    if (r.location) headers.set("location", r.location);
    return new Response(null, { status: r.status, headers });
  }) as typeof globalThis.fetch;
  return calls;
}

// Wrapped in a main() · this repo's tsx transform targets cjs, which
// has no top-level await.
async function main() {
try {
  // 1. The attack: a public domain that passes the guard, then bounces
  //    to loopback. Must return null, and must NEVER request the
  //    internal URL — asserting on `calls` is what makes this a real
  //    test rather than a check that some null came back.
  {
    const calls = stubFetch({
      "https://evil.example/.well-known/nostr.json": {
        status: 302,
        location: "http://127.0.0.1:6379/",
      },
    });
    const res = await safeFetch("https://evil.example/.well-known/nostr.json");
    check("302 -> loopback returns null", res === null);
    check(
      "302 -> loopback is never requested",
      calls.length === 1 && !calls.some((c) => c.includes("127.0.0.1")),
    );
  }

  // 2. Same, via the cloud metadata IP on https (so only the private
  //    range check — not the scheme check — can be what stops it).
  {
    const calls = stubFetch({
      "https://evil.example/x": {
        status: 307,
        location: "https://169.254.169.254/computeMetadata/v1/",
      },
    });
    const res = await safeFetch("https://evil.example/x");
    check("307 -> metadata IP returns null", res === null);
    check("metadata IP is never requested", calls.length === 1);
  }

  // 3. A redirect to a trailing-dot loopback name — the two bypasses
  //    composed. This is the case that needed BOTH fixes to fail shut.
  {
    const calls = stubFetch({
      "https://evil.example/x": { status: 302, location: "https://localhost./" },
    });
    const res = await safeFetch("https://evil.example/x");
    check("302 -> localhost. returns null", res === null);
    check("localhost. is never requested", calls.length === 1);
  }

  // 4. Legitimate redirects MUST still work · www -> apex is normal for
  //    NIP-05 / LNURL endpoints. Refusing all 3xx would drop real
  //    vendors, which is why the fix follows-and-revalidates.
  {
    stubFetch({
      "https://www.vendor.example/.well-known/nostr.json": {
        status: 301,
        location: "https://vendor.example/.well-known/nostr.json",
      },
      "https://vendor.example/.well-known/nostr.json": { status: 200 },
    });
    const res = await safeFetch("https://www.vendor.example/.well-known/nostr.json");
    check("www -> apex redirect is followed", res !== null && res.status === 200);
  }

  // 5. Relative Location resolves against the current URL, then gets
  //    re-validated like any other hop.
  {
    stubFetch({
      "https://vendor.example/a": { status: 302, location: "/b" },
      "https://vendor.example/b": { status: 200 },
    });
    const res = await safeFetch("https://vendor.example/a");
    check("relative Location is resolved and followed", res !== null && res.status === 200);
  }

  // 6. Redirect loops terminate rather than hanging or recursing.
  {
    const calls = stubFetch({
      "https://vendor.example/loop": {
        status: 302,
        location: "https://vendor.example/loop",
      },
    });
    const res = await safeFetch("https://vendor.example/loop", {}, 3);
    check("redirect loop returns null", res === null);
    check("redirect loop is bounded by maxRedirects", calls.length === 4);
  }

  // 7. The initial URL is validated too — safeFetch is a complete
  //    replacement for validate-then-fetch, not an add-on to it.
  {
    const calls = stubFetch({});
    const res = await safeFetch("https://127.0.0.1/");
    check("initial private URL returns null", res === null);
    check("initial private URL is never requested", calls.length === 0);
  }

  // 8. A non-redirect response passes straight through untouched.
  {
    stubFetch({ "https://vendor.example/ok": { status: 404 } });
    const res = await safeFetch("https://vendor.example/ok");
    check("non-3xx response is returned as-is", res !== null && res.status === 404);
  }

  // 9. readCappedJson stops reading once the cap is crossed. A check
  //    that only slices after res.text() still buffers the attack body.
  console.log("\nreadCappedJson · the cap bounds the read");
  {
    const parsed = await readCappedJson(
      new Response(JSON.stringify({ ok: true })),
      100,
    );
    check(
      "under-cap JSON parses",
      typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { ok?: boolean }).ok === true,
    );
  }
  {
    let canceled = false;
    let pulls = 0;
    const enc = new TextEncoder();
    const chunks = [
      enc.encode('{"a":"'),
      enc.encode("B".repeat(40)),
      enc.encode("C".repeat(40)),
    ];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[pulls]);
        pulls++;
      },
      cancel() {
        canceled = true;
      },
    });
    const parsed = await readCappedJson(new Response(stream), 20);
    check("over-cap JSON is dropped", parsed === null);
    check("over-cap read cancels the rest of the stream", canceled);
    check("over-cap read does not pull the tail chunk", pulls === 2);
  }
  {
    const junk = await readCappedJson(new Response("not-json"), 100);
    check("invalid JSON is dropped", junk === null);
  }
} finally {
  globalThis.fetch = realFetch;
}
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log("✓ safe-fetch guard: trailing-dot + redirect-revalidation all green");
});
