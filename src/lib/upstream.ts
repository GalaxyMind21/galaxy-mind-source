// Centralized upstream fetch for known public APIs (CoinGecko, Yahoo,
// Coinmetrics, OKX, mempool, bitcointreasuries, …).
//
// Distinct from `safe-fetch.ts`, which validates *user-controlled*
// domains against SSRF. This module is for allow-listed vendor endpoints
// we already trust by URL, with:
//   - 5s AbortSignal ceiling (default)
//   - consistent redacted error logging
//   - optional Zod schema-drift detection (warn only; never throws)
//   - optional single retry on network / 5xx with short jitter
//
// Happy-path semantics match the previous per-call try/fetch in
// market.ts: callers still treat failures as null / neutral signals.

import { z } from "zod";

export const UPSTREAM_TIMEOUT_MS = 5_000;

export type UpstreamOk<T> = { ok: true; data: T; status: number };
export type UpstreamErr = { ok: false; error: string; status?: number };
export type UpstreamResult<T> = UpstreamOk<T> | UpstreamErr;

/** Yahoo chart endpoints reject bare Node UAs; keep the browser-ish string. */
export const YAHOO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

export const GM_UA =
  "Mozilla/5.0 (compatible; GalaxyMind/1.0; +https://galaxymind.space)";

/**
 * Detection-only schema check. Logs a short warn when the shape drifts
 * so operators see `[upstream:label] schema drift` in Vercel logs.
 * Never throws; never changes the returned payload.
 */
export function logSchemaDrift(
  label: string,
  result: { success: true } | { success: false; error: z.ZodError },
): void {
  if (result.success) return;
  const detail = result.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  console.warn(`[upstream:${label}] schema drift · ${detail}`);
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(bad-url)";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type UpstreamFetchOpts = {
  /** Short label for logs · e.g. "btcprice", "mvrv". */
  label: string;
  timeoutMs?: number;
  /** Next.js data-cache revalidate window (seconds). */
  revalidate?: number;
  headers?: HeadersInit;
  /**
   * One retry after 300–600ms jitter on network failure or HTTP 5xx.
   * Default false — market snapshot prefers fast fail-to-null.
   */
  retry?: boolean;
};

async function once(
  url: string,
  opts: UpstreamFetchOpts,
): Promise<UpstreamResult<Response>> {
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  try {
    const init: RequestInit & { next?: { revalidate?: number } } = {
      headers: opts.headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (opts.revalidate != null) {
      init.next = { revalidate: opts.revalidate };
    }
    const r = await fetch(url, init);
    if (!r.ok) {
      return {
        ok: false,
        error: `HTTP ${r.status}`,
        status: r.status,
      };
    }
    return { ok: true, data: r, status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Low-level fetch returning a Response on success. Retries once on
 * network errors or 5xx when `retry: true`.
 */
export async function upstreamFetch(
  url: string,
  opts: UpstreamFetchOpts,
): Promise<UpstreamResult<Response>> {
  const first = await once(url, opts);
  if (first.ok) return first;

  const status = first.status;
  const retriable =
    opts.retry === true &&
    (status == null || (status >= 500 && status <= 599));

  if (!retriable) {
    console.error(
      `[upstream:${opts.label}] failed · ${redactUrl(url)} · ${first.error}`,
    );
    return first;
  }

  await sleep(300 + Math.floor(Math.random() * 300));
  const second = await once(url, opts);
  if (!second.ok) {
    console.error(
      `[upstream:${opts.label}] failed after retry · ${redactUrl(url)} · ${second.error}`,
    );
  }
  return second;
}

/**
 * Fetch + parse JSON. Optional Zod schema runs logSchemaDrift only.
 */
export async function upstreamFetchJson<T = unknown>(
  url: string,
  opts: UpstreamFetchOpts & { schema?: z.ZodTypeAny },
): Promise<UpstreamResult<T>> {
  const res = await upstreamFetch(url, opts);
  if (!res.ok) return res;
  try {
    const data = (await res.data.json()) as T;
    if (opts.schema) {
      logSchemaDrift(opts.label, opts.schema.safeParse(data));
    }
    return { ok: true, data, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[upstream:${opts.label}] JSON parse failed · ${redactUrl(url)} · ${msg}`,
    );
    return { ok: false, error: msg, status: res.status };
  }
}

/**
 * Fetch + read body as text (mempool.space block height, etc.).
 */
export async function upstreamFetchText(
  url: string,
  opts: UpstreamFetchOpts,
): Promise<UpstreamResult<string>> {
  const res = await upstreamFetch(url, opts);
  if (!res.ok) return res;
  try {
    const text = await res.data.text();
    return { ok: true, data: text, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[upstream:${opts.label}] text read failed · ${redactUrl(url)} · ${msg}`,
    );
    return { ok: false, error: msg, status: res.status };
  }
}
