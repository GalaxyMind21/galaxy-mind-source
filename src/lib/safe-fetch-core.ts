// Internal core of the SSRF-guarded fetch (review S4-a, 2026-10).
// Server-only: node:dns and node:https.
//
// Do NOT import this from src/ code. src/ uses ./safe-fetch, whose
// safeFetch always runs on the DNS-pinned transport and takes no transport
// option. Operator scripts and tests that need a scripted or explicitly
// pinned transport use ./safe-fetch-transport, which src/ must never
// import. scripts/check-safe-fetch-imports.ts fails verify otherwise.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { isBlockedIp, validateOutboundUrl } from "./outbound-url";

// ---------------------------------------------------------------------
// Layer 3 · DNS-pinned HTTPS transport
// ---------------------------------------------------------------------

/** Resolves a hostname to every address in its DNS answer. */
export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });

/** Error raised when a DNS answer contains a blocked address. */
export class BlockedAddressError extends Error {
  readonly code = "ESSRFBLOCKED";
  constructor(hostname: string) {
    super(`[safe-fetch] ${hostname} resolves to a blocked address`);
    this.name = "BlockedAddressError";
  }
}

/**
 * Build a `lookup` for net/tls connect that resolves the hostname,
 * rejects the whole answer if ANY address is blocked, and hands the
 * socket only addresses it has checked. Each call resolves once and
 * checks that same answer, so a resolver that flips from a public to a
 * private address between calls is caught on the call that returns the
 * private one.
 */
export function createPinnedLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    const family =
      typeof options === "object" && options && (options.family === 4 || options.family === 6)
        ? options.family
        : 0;
    const wantAll = typeof options === "object" && options !== null && options.all === true;
    resolve(hostname).then(
      (answer) => {
        const addresses = (answer ?? []).filter(
          (a) => a && typeof a.address === "string",
        );
        if (addresses.length === 0) {
          const err = Object.assign(new Error(`[safe-fetch] no address for ${hostname}`), {
            code: "ENOTFOUND",
          });
          callback(err, "", 0);
          return;
        }
        if (addresses.some((a) => isBlockedIp(a.address))) {
          callback(new BlockedAddressError(hostname), "", 0);
          return;
        }
        const usable = addresses
          .map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }))
          .filter((a) => family === 0 || a.family === family);
        if (usable.length === 0) {
          const err = Object.assign(
            new Error(`[safe-fetch] no IPv${family} address for ${hostname}`),
            { code: "ENOTFOUND" },
          );
          callback(err, "", 0);
          return;
        }
        if (wantAll) callback(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      },
      (err: unknown) => {
        callback(err instanceof Error ? err : new Error(String(err)), "", 0);
      },
    );
  };
}

/** One HTTP exchange, no redirect following. Same shape as fetch. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function decodeBody(res: IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(createGunzip());
  if (enc === "deflate") return res.pipe(createInflate());
  if (enc === "br") return res.pipe(createBrotliDecompress());
  return res;
}

/**
 * HTTPS request over node:https with the pinned lookup. Port 443 only,
 * TLS certificate checked against the hostname (not the IP), and the
 * response returned as a standard Response so callers are unchanged.
 * Redirects are NOT followed; safeFetch handles them.
 */
export function createPinnedTransport(resolve: Resolver = systemResolver): Transport {
  const lookup = createPinnedLookup(resolve);
  return (urlStr, init) =>
    new Promise<Response>((resolvePromise, reject) => {
      let url: URL;
      try {
        url = new URL(urlStr);
      } catch (err) {
        reject(err);
        return;
      }
      if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
        reject(new Error("[safe-fetch] pinned transport is HTTPS on 443 only"));
        return;
      }
      const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
      // IP literals skip DNS entirely, so check them here. (validateOutboundUrl
      // already refuses private IPv4 and all IPv6 literals; this is belt and braces.)
      if (isIP(host) && isBlockedIp(host)) {
        reject(new BlockedAddressError(host));
        return;
      }
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const body = init.body;
      if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) {
        reject(new Error("[safe-fetch] only string or byte request bodies are supported"));
        return;
      }
      const req = httpsRequest({
        protocol: "https:",
        hostname: host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: (init.method ?? "GET").toUpperCase(),
        headers,
        lookup,
        servername: isIP(host) ? undefined : host,
        agent: false,
        signal: init.signal ?? undefined,
      });
      req.once("error", reject);
      req.once("response", (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          res.resume();
          reject(new Error(`[safe-fetch] unsupported status ${status}`));
          return;
        }
        const resHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value == null) continue;
          if (Array.isArray(value)) for (const v of value) resHeaders.append(key, v);
          else resHeaders.set(key, String(value));
        }
        let stream: ReadableStream<Uint8Array> | null = null;
        const isHead = (init.method ?? "GET").toUpperCase() === "HEAD";
        if (NULL_BODY_STATUS.has(status) || isHead) {
          res.resume();
        } else {
          const decoded = decodeBody(res);
          if (decoded !== res) {
            resHeaders.delete("content-encoding");
            resHeaders.delete("content-length");
          }
          stream = Readable.toWeb(decoded) as unknown as ReadableStream<Uint8Array>;
        }
        resolvePromise(
          new Response(stream, {
            status,
            statusText: res.statusMessage ?? "",
            headers: resHeaders,
          }),
        );
      });
      if (body != null) req.write(body);
      req.end();
    });
}

/**
 * Whole-chain deadline when the caller passes no signal (PR #188 S-1). It
 * covers DNS too: a stalled resolver used to hang a signal-less call forever.
 */
export const SAFE_FETCH_DEFAULT_TIMEOUT_MS = 10_000;

/** Reject as soon as `signal` aborts, even if `p` never settles (a stalled transport or resolver). */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/**
 * The redirect-following, re-validating chain behind safeFetch (see the doc
 * on safeFetch in ./safe-fetch). It takes the wire transport explicitly.
 * Only ./safe-fetch (with the pinned transport) and ./safe-fetch-transport
 * (scripts only) may import this module; scripts/check-safe-fetch-imports.ts
 * enforces that for everything under src/.
 */
export async function runSafeFetch(
  urlStr: string,
  init: RequestInit,
  maxRedirects: number,
  transport: Transport,
  defaultTimeoutMs: number,
): Promise<Response | null> {
  // One deadline for the whole exchange (DNS, connect, redirects and the
  // body read) when the caller gave none. A plain ref'd timer rather than
  // AbortSignal.timeout, whose unref'd timer would let a CLI script exit
  // mid-request instead of getting null. On a null result the timer is
  // cleared; on a Response it keeps running (unref'd, so it never holds the
  // process open by itself) so a stalled body is cut off too.
  if (init.signal) return safeFetchChain(urlStr, init, init.signal, maxRedirects, transport);
  const ctl = new AbortController();
  const timer = setTimeout(
    () => ctl.abort(new Error("[safe-fetch] timed out")),
    defaultTimeoutMs,
  );
  let res: Response | null = null;
  try {
    res = await safeFetchChain(urlStr, { ...init, signal: ctl.signal }, ctl.signal, maxRedirects, transport);
    return res;
  } finally {
    if (res) timer.unref?.();
    else clearTimeout(timer);
  }
}

async function safeFetchChain(
  urlStr: string,
  init: RequestInit,
  signal: AbortSignal,
  maxRedirects: number,
  transport: Transport,
): Promise<Response | null> {
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validation = validateOutboundUrl(current);
    if (!validation.ok) {
      // Only log past hop 0 · the caller already logs its own initial
      // reject with richer context, and a redirect reject is the
      // interesting (attack-shaped) event worth surfacing on its own.
      if (hop > 0) {
        console.warn(
          `[safe-fetch] redirect blocked · hop=${hop} · ${validation.reason}`,
        );
      }
      return null;
    }
    let res: Response;
    try {
      res = await raceAbort(transport(current, { ...init, redirect: "manual" }), signal);
    } catch (err) {
      if (err instanceof BlockedAddressError) {
        console.warn(`[safe-fetch] blocked by DNS check · hop=${hop}`);
      }
      return null;
    }
    // 304 is not a redirect for our purposes and carries no Location.
    const isRedirect =
      res.status === 301 ||
      res.status === 302 ||
      res.status === 303 ||
      res.status === 307 ||
      res.status === 308;
    if (!isRedirect) return withUrl(res, current);
    const location = res.headers.get("location");
    if (!location) return withUrl(res, current);
    // Drain the redirect body so the socket is released.
    await res.body?.cancel().catch(() => {});
    // Resolve relative Locations against the CURRENT url, then loop so
    // the next iteration re-validates the absolute result.
    try {
      current = new URL(location, current).toString();
    } catch {
      return null;
    }
  }
  console.warn(`[safe-fetch] too many redirects (> ${maxRedirects})`);
  return null;
}

/** Give a Response its final URL when the transport left it blank. */
function withUrl(res: Response, url: string): Response {
  if (res.url) return res;
  try {
    Object.defineProperty(res, "url", { value: url, configurable: true });
  } catch {
    /* read-only in this runtime · callers fall back to their own URL */
  }
  return res;
}
