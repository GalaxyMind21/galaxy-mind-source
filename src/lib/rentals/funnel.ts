/**
 * Direct-rental funnel (operator 2026-10-17: the direct desk is an experiment; this is how we judge it).
 * Privacy: an explicit allow-list of coarse props only: channel (web | mcp), rail (base | solana), rigs,
 * days, count, outcome. Never an order id, pool, worker, wallet address, tx hash, IP or email.
 * Best effort: a tracking failure never affects a rental.
 *
 * Review #106 F1: SERVER-SIDE events never go to @vercel/analytics. Its server track() attaches the request
 * URL (e.g. /api/rentals/pay/x402_<ref>), x-forwarded-for, the user agent and cookies, which would link payment
 * refs to IPs. Server events are one structured log line ("[funnel] {...}": event + allow-listed props, nothing
 * else), counted from the runtime logs. Web events (quote viewed, order created, paid) fire CLIENT-side from
 * /hashrate/rent through the SiteAnalytics beforeSend scrub. A server event is also refused outright when the
 * current request URL carries a ref or rental id (x402_ / gm_), so the pay route can never emit one.
 */
export const FUNNEL_EVENTS = ["rental_quote_viewed", "rental_order_created", "rental_paid", "rental_paid_total", "rental_expired"] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
export type FunnelProps = { channel?: "web" | "mcp"; rail?: "base" | "solana"; rigs?: number; days?: number; count?: number; outcome?: string };

const OUTCOMES = new Set(["settled", "retry", "cap_exceeded", "kill_switch", "late", "underpaid", "duplicate", "no_capacity"]);
const smallInt = (n: unknown, max: number) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max ? n : undefined);

/** Allow-list projection. Anything not listed is dropped; values outside their range are dropped. */
export function funnelProps(p: FunnelProps): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (p.channel === "web" || p.channel === "mcp") out.channel = p.channel;
  if (p.rail === "base" || p.rail === "solana") out.rail = p.rail;
  const rigs = smallInt(p.rigs, 999), days = smallInt(p.days, 366), count = smallInt(p.count, 100_000);
  if (rigs !== undefined) out.rigs = rigs;
  if (days !== undefined) out.days = days;
  if (count !== undefined) out.count = count;
  if (typeof p.outcome === "string" && OUTCOMES.has(p.outcome)) out.outcome = p.outcome;
  return out;
}

/** CAIP-2 network -> coarse rail label. */
export function railOf(network: string | null | undefined): "base" | "solana" | undefined {
  if (!network) return undefined;
  if (network.startsWith("solana:")) return "solana";
  if (network.startsWith("eip155:")) return "base";
  return undefined;
}

type TrackFn = (name: string, props?: Record<string, string | number>) => Promise<void>;
let override: TrackFn | null = null;
/** Tests only. */
export function setFunnelTracker(fn: TrackFn | null) { override = fn; }

/** A request URL that identifies a payment or rental (pay route x402_<ref>, gm_<id>). */
export const REF_URL_RE = /x402_|gm_[a-z0-9]/i;
/** The URL of the request being served (Vercel request context), or null outside a request. */
function requestUrl(): string | null {
  try {
    const c = (globalThis as Record<symbol, { get?: () => { url?: unknown } | undefined } | undefined>)[Symbol.for("@vercel/request-context")]?.get?.();
    return typeof c?.url === "string" ? c.url : null;
  } catch { return null; }
}

export async function trackFunnel(name: FunnelEvent, props: FunnelProps = {}): Promise<void> {
  try {
    const url = requestUrl();
    if (url && REF_URL_RE.test(url)) return; // F1: never from a request that names a ref or rental
    const clean = funnelProps(props);
    if (override) { await override(name, clean); return; }
    if (process.env.VERCEL !== "1") return; // local runs and tests send nothing
    console.info("[funnel] " + JSON.stringify({ event: name, ...clean }));
  } catch { /* best effort */ }
}
