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

import type { LookupAddress } from "node:dns";

import {
  BlockedAddressError,
  createPinnedLookup,
  isBlockedIp,
  SAFE_FETCH_DEFAULT_TIMEOUT_MS,
  readCappedJson,
  safeFetch as pinnedSafeFetch,
  validateOutboundUrl,
  type Resolver,
} from "../src/lib/safe-fetch";
// Scripts and tests only: src/ may never import this (check-safe-fetch-imports).
import {
  createPinnedTransport,
  safeFetchWithTransport as realSafeFetch,
} from "../src/lib/safe-fetch-transport";

// The redirect tests below script responses through a stubbed global
// fetch. safeFetch's default transport is the DNS-pinned node:https one,
// so route these calls through the stub explicitly.
const viaStub = (u: string, i: RequestInit) => globalThis.fetch(u, i);
const safeFetch = (u: string, init: RequestInit = {}, max = 3) =>
  realSafeFetch(u, init, max, { transport: viaStub });

// S4-a: the src-facing safeFetch has no transport (or deadline) option.
// @ts-expect-error a 4th argument is a type error now; tsc --noEmit fails if it ever compiles again.
void (() => pinnedSafeFetch("https://example.com/", {}, 3, { transport: viaStub }));

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


// ---------------------------------------------------------------
// CodeQL review 2026-10 · resolved-address rules + DNS pinning
// ---------------------------------------------------------------
function addressChecks() {
  console.log("\nisBlockedIp · IPv4");
  for (const ip of [
    "127.0.0.1", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "100.127.255.254", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "192.0.2.1", "198.18.0.1",
  ]) check(`${ip} blocked`, isBlockedIp(ip));
  check("public IPv4 allowed", !isBlockedIp("93.184.216.34"));
  check("CGNAT neighbour allowed", !isBlockedIp("100.128.0.1"));
  check("leading-zero IPv4 fails closed", isBlockedIp("010.0.0.1"));
  check("garbage fails closed", isBlockedIp("not-an-ip") && isBlockedIp(""));

  console.log("\nisBlockedIp · IPv6, including mapped forms");
  for (const ip of [
    "::", "::1", "0:0:0:0:0:0:0:1", "fe80::1", "fe80::1%eth0", "febf::1",
    "fc00::1", "fd12:3456::1", "fd00:ec2::254", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe", "::ffff:100.64.0.1", "::127.0.0.1", "::ffff:0:7f00:1",
    "64:ff9b::7f00:1", "64:ff9b::10.1.2.3", "64:ff9b:1::1", "2002:7f00:1::1",
    "2002:c0a8:101::", "2001:db8::1", "2001::1", "100::1", "3fff::1", "[::1]",
  ]) check(`${ip} blocked`, isBlockedIp(ip));
  check("public IPv6 allowed", !isBlockedIp("2606:4700::1111"));
  check("mapped public IPv4 allowed", !isBlockedIp("::ffff:93.184.216.34"));
  check("NAT64 of public IPv4 allowed", !isBlockedIp("64:ff9b::5db8:d822"));
  console.log("\nisBlockedIp · IPv6 allowlist: only global unicast 2000::/3 (S-3)");
  for (const ip of [
    "::1:2:3:4", "1::1", "400::1", "1fff:ffff::1", "4000::1", "6000::1", "8000::1",
    "a000::1", "c000::1", "e000::1", "f000::1", "fbff::1", "::2", "0:0:0:1::",
  ]) check(`${ip} (outside 2000::/3) blocked`, isBlockedIp(ip));
  check("first address of 2000::/3 allowed", !isBlockedIp("2000::1"));
  check("last block of 2000::/3 allowed", !isBlockedIp("3ffe:ffff::1"));
  check("typical global unicast allowed", !isBlockedIp("2a00:1450:4001::200e") && !isBlockedIp("2400:cb00::1"));
  check("special ranges inside 2000::/3 still blocked", isBlockedIp("2001:db8::1") && isBlockedIp("2001::1") && isBlockedIp("2002:a00:1::") && isBlockedIp("3fff::1"));
  check("malformed IPv6 fails closed", isBlockedIp("1::2::3") && isBlockedIp("12345::1") && isBlockedIp(":::"));
}

type LookupResult = { err: Error | null; address: unknown; family?: number };
function runLookup(
  resolver: Resolver,
  options: { all?: boolean; family?: number } = {},
): Promise<LookupResult> {
  const lookup = createPinnedLookup(resolver);
  return new Promise((resolve) => {
    lookup("rebind.example", options as never, ((err: Error | null, address: unknown, family?: number) => {
      resolve({ err, address, family });
    }) as never);
  });
}

const answer = (...ips: string[]): LookupAddress[] =>
  ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

async function pinningChecks() {
  console.log("\ncreatePinnedLookup · check and connect use one answer");
  {
    const r = await runLookup(async () => answer("93.184.216.34"));
    check("public answer is handed to the socket", r.err === null && r.address === "93.184.216.34" && r.family === 4);
  }
  {
    const r = await runLookup(async () => answer("93.184.216.34"), { all: true });
    check(
      "all:true form returns the checked list",
      r.err === null && Array.isArray(r.address) && (r.address as LookupAddress[])[0].address === "93.184.216.34",
    );
  }
  {
    const r = await runLookup(async () => answer("10.0.0.7"));
    check("private answer is refused", r.err instanceof BlockedAddressError);
  }
  {
    const r = await runLookup(async () => answer("93.184.216.34", "127.0.0.1"));
    check("mixed public + private answer is refused whole", r.err instanceof BlockedAddressError);
  }
  {
    const r = await runLookup(async () => answer("::ffff:169.254.169.254"));
    check("IPv4-mapped metadata answer is refused", r.err instanceof BlockedAddressError);
  }
  {
    const r = await runLookup(async () => answer("fd00:ec2::254"));
    check("IPv6 metadata (ULA) answer is refused", r.err instanceof BlockedAddressError);
  }
  {
    const r = await runLookup(async () => []);
    check("empty answer fails closed", r.err !== null && !(r.err instanceof BlockedAddressError));
  }
  {
    const r = await runLookup(async () => {
      throw new Error("SERVFAIL");
    });
    check("resolver error fails closed", r.err !== null);
  }
  {
    const r = await runLookup(async () => answer("93.184.216.34", "2606:4700::1111"), { family: 6 });
    check("family filter picks only checked addresses of that family", r.err === null && r.address === "2606:4700::1111" && r.family === 6);
  }

  // Rebinding: the resolver answers public first, then private. Every
  // connection attempt resolves through the pinned lookup, so the flip
  // is caught on the attempt that sees the private answer, and the
  // address handed to the socket is always the one that was checked.
  console.log("\nDNS rebinding · public then private");
  {
    let calls = 0;
    const flipping: Resolver = async () => {
      calls++;
      return calls === 1 ? answer("93.184.216.34") : answer("127.0.0.1");
    };
    const lookup = createPinnedLookup(flipping);
    const first = await new Promise<LookupResult>((resolve) =>
      lookup("rebind.example", {} as never, ((err: Error | null, address: unknown, family?: number) =>
        resolve({ err, address, family })) as never),
    );
    const second = await new Promise<LookupResult>((resolve) =>
      lookup("rebind.example", {} as never, ((err: Error | null, address: unknown, family?: number) =>
        resolve({ err, address, family })) as never),
    );
    check("first (public) answer connects to the checked address", first.err === null && first.address === "93.184.216.34");
    check("second (private) answer is refused", second.err instanceof BlockedAddressError);
    check("resolver was consulted once per connection", calls === 2);
  }

  // S-1: a signal-less call gets a default deadline that also covers DNS.
  console.log("\nsafeFetch · default timeout when no signal is passed (S-1)");
  {
    check("default timeout is 10 s", SAFE_FETCH_DEFAULT_TIMEOUT_MS === 10_000);
    let seen: AbortSignal | undefined;
    const t0 = Date.now();
    const res = await realSafeFetch("https://stall.example/x", {}, 3, {
      defaultTimeoutMs: 300,
      transport: (_u, init) => {
        seen = init.signal ?? undefined;
        return new Promise<Response>(() => {}); // never settles, ignores the signal
      },
    });
    const ms = Date.now() - t0;
    check(`stalled transport returns null at the deadline (${ms} ms)`, res === null && ms >= 250 && ms < 3000);
    check("a signal is handed to the transport when the caller passed none", seen instanceof AbortSignal);
  }
  {
    // Real pinned transport + a resolver that never answers: the deadline must still fire.
    let resolverCalls = 0;
    const stalledDns: Resolver = () => {
      resolverCalls++;
      return new Promise<LookupAddress[]>(() => {});
    };
    const t0 = Date.now();
    const res = await realSafeFetch("https://stall.example/x", {}, 3, {
      defaultTimeoutMs: 300,
      transport: createPinnedTransport(stalledDns),
    });
    const ms = Date.now() - t0;
    check(`stalled DNS returns null at the deadline (${ms} ms)`, res === null && ms >= 250 && ms < 3000);
    check("the stalled resolver was actually consulted", resolverCalls >= 1);
  }
  {
    // A caller's own signal wins over the default.
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    const t0 = Date.now();
    const res = await realSafeFetch("https://stall.example/x", { signal: ctl.signal }, 3, {
      defaultTimeoutMs: 5_000,
      transport: () => new Promise<Response>(() => {}),
    });
    const ms = Date.now() - t0;
    check(`caller's signal is honoured (${ms} ms)`, res === null && ms < 2000);
  }

  // End to end through the real node:https transport: the socket's own
  // lookup is the pinned one, so a loopback DNS answer fails the connect
  // with BlockedAddressError before any TCP handshake. Offline: the
  // resolver is scripted and the request never leaves the process.
  console.log("\npinned transport · private DNS answer never connects");
  {
    let resolverCalls = 0;
    const toLoopback: Resolver = async () => {
      resolverCalls++;
      return answer("127.0.0.1");
    };
    const transport = createPinnedTransport(toLoopback);
    let threw: unknown = null;
    try {
      await transport("https://rebind.example/.well-known/nostr.json", {});
    } catch (err) {
      threw = err;
    }
    check("transport rejects a loopback DNS answer", threw instanceof BlockedAddressError);
    check("transport consulted the pinned resolver", resolverCalls >= 1);

    const viaSafeFetch = await realSafeFetch(
      "https://rebind.example/x",
      {},
      3,
      { transport },
    );
    check("safeFetch returns null when DNS points private", viaSafeFetch === null);
  }
  {
    let threw: unknown = null;
    try {
      await createPinnedTransport(async () => answer("93.184.216.34"))("http://vendor.example/", {});
    } catch (err) {
      threw = err;
    }
    check("transport refuses plain http", threw instanceof Error);
    threw = null;
    try {
      await createPinnedTransport(async () => answer("93.184.216.34"))("https://vendor.example:8443/", {});
    } catch (err) {
      threw = err;
    }
    check("transport refuses non-443 ports", threw instanceof Error);
    threw = null;
    try {
      await createPinnedTransport(async () => answer("93.184.216.34"))("https://127.0.0.1/", {});
    } catch (err) {
      threw = err;
    }
    check("transport refuses a private IP literal without DNS", threw instanceof BlockedAddressError);
  }
}

// If the event loop drains before the summary prints (e.g. a test awaits a
// promise that only an unref'd timer would settle), fail instead of exiting 0.
let finished = false;
process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.log("\nFAIL  test run ended before the summary (event loop drained)");
    process.exitCode = 1;
  }
});

main()
  .then(() => addressChecks())
  .then(() => pinningChecks())
  .then(() => {
  finished = true;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log("✓ safe-fetch guard: trailing-dot + redirect-revalidation + DNS pinning + default timeout all green");
});
