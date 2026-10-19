// Pure core of GET /api/hashrate/quote, so the runtime test can call it without Next.js.
// B1 (2026-10-17): the same directQuote (getQuote -> priceOrder) as MCP get_quote / get_rental_quote.
import type { Deps } from "./phase2/service";
import { stagingDeps } from "./phase2/staging";
import { assertCustomerSafe, closeTheSale } from "./index";
import { directQuote } from "./direct";

type HttpDeps = { deps?: () => Deps | null; env?: Record<string, string | undefined>; now?: number };

const STATUS: Record<string, number> = { invalid_input: 400, below_minimum: 400, above_maximum: 400, invalid_quote: 400, none_available: 409, no_capacity: 409, pricing_unavailable: 503 };

export async function buildDirectQuoteResponse(params: URLSearchParams, opts: HttpDeps = {}): Promise<{ status: number; body: unknown }> {
  const env = opts.env ?? process.env;
  const finish = closeTheSale(env);
  const raw = { rigs: params.get("rigs") ?? undefined, ph: params.get("ph") ?? undefined, days: params.get("days") ?? undefined };
  let d: Deps | null = null;
  try { d = (opts.deps ?? (() => stagingDeps(env)))(); } catch { d = null; }
  const out = await directQuote(d, raw, { now: opts.now, env });
  if (!out.ok) {
    const body = { error: out.error, message: out.message, ...(out.supported ? { supported: out.supported } : {}), closeTheSale: finish };
    return { status: STATUS[out.error] ?? 400, body: assertCustomerSafe(body) };
  }
  return { status: 200, body: assertCustomerSafe({ ...out.result, closeTheSale: finish }) };
}
