// SCRIPTS AND TESTS ONLY (review S4-a, 2026-10).
//
// safeFetch with a caller-chosen wire transport and deadline. Tests use it
// to script responses offline; operator scripts may pass an explicitly
// pinned transport (createPinnedTransport with their own resolver).
//
// Nothing under src/ may import this module, by any import form or
// re-export. scripts/check-safe-fetch-imports.ts fails verify otherwise.
// src/ code uses safeFetch from ./safe-fetch, which is always pinned.

import {
  createPinnedTransport,
  runSafeFetch,
  SAFE_FETCH_DEFAULT_TIMEOUT_MS,
  type Transport,
} from "./safe-fetch-core";

export {
  BlockedAddressError,
  createPinnedLookup,
  createPinnedTransport,
  type Resolver,
  type Transport,
} from "./safe-fetch-core";

export type SafeFetchTransportOptions = {
  /** Wire transport. Defaults to the DNS-pinned node:https transport. */
  transport?: Transport;
  /** Replaces SAFE_FETCH_DEFAULT_TIMEOUT_MS when the caller passes no signal. */
  defaultTimeoutMs?: number;
};

let pinned: Transport | null = null;

/** safeFetch (same redirect re-validation and deadline) over the given transport. */
export function safeFetchWithTransport(
  urlStr: string,
  init: RequestInit = {},
  maxRedirects = 3,
  options: SafeFetchTransportOptions = {},
): Promise<Response | null> {
  const transport = options.transport ?? (pinned ??= createPinnedTransport());
  return runSafeFetch(
    urlStr,
    init,
    maxRedirects,
    transport,
    options.defaultTimeoutMs ?? SAFE_FETCH_DEFAULT_TIMEOUT_MS,
  );
}
