/**
 * Which credentials the server uses to read public.pricing_daily (security audit 2026-10-18, L4).
 * Server-only: every value here is a Vercel Sensitive env and never NEXT_PUBLIC.
 *
 * `import "server-only"` makes a client bundle that reaches this module fail the build.
 *
 * Order:
 *   0. RENTALS_PRICING_READ_KEY, a JWT for the narrow pricing_reader role (SELECT on pricing_daily only; created by the
 *      revoke migration). Preferred over any service key.
 *   1. RENTALS_SUPABASE_SERVICE_KEY, a dedicated server-only key for RENTALS_SUPABASE_URL.
 *   2. RENTALS_PHASE2_SUPABASE_SERVICE_KEY, but only when RENTALS_PHASE2_SUPABASE_URL is the same project as
 *      RENTALS_SUPABASE_URL (a key is never sent to a project it doesn't belong to).
 *   3. RENTALS_SUPABASE_KEY (the public anon key). This keeps working until the revoke migration
 *      (supabase/migrations/20261019030000_pricing_daily_revoke_anon_select.sql) is applied; after that it gets a
 *      permission error and every caller fails closed.
 */
import "server-only";

type Env = Record<string, string | undefined>;

const norm = (u: string | undefined) => (u ?? "").trim().replace(/\/+$/, "").toLowerCase();

export function pricingReadCreds(env: Env = process.env): { url: string; key: string; source: "reader" | "service" | "phase2_service" | "anon" } | null {
  const url = (env.RENTALS_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(url)) return null;
  const reader = (env.RENTALS_PRICING_READ_KEY ?? "").trim();
  if (reader) return { url, key: reader, source: "reader" };
  const own = (env.RENTALS_SUPABASE_SERVICE_KEY ?? "").trim();
  if (own) return { url, key: own, source: "service" };
  const p2 = (env.RENTALS_PHASE2_SUPABASE_SERVICE_KEY ?? "").trim();
  if (p2 && norm(env.RENTALS_PHASE2_SUPABASE_URL) === norm(url)) return { url, key: p2, source: "phase2_service" };
  const anon = (env.RENTALS_SUPABASE_KEY ?? "").trim();
  if (anon) return { url, key: anon, source: "anon" };
  return null;
}
