import { pilotOn } from "../limits";
/**
 * Feature flag. Default OFF. Phase 2 tools register only when
 *   RENTALS_PHASE2_ENABLED=1 and RENTALS_PHASE2_MODE=staging
 * or RENTALS_PHASE2_MODE=mainnet with every mainnetEnabled() gate. Any other mode is refused.
 */
/** Launch is USDC via x402 on Base only. Lightning is deferred: off unless RENTALS_LIGHTNING_ENABLED=1. */
export function lightningEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RENTALS_LIGHTNING_ENABLED === "1";
}
/** True on the Vercel production deployment (VERCEL_ENV=production). */
export function isProductionDeploy(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === "production";
}
/**
 * The public site base for x402 resources and pay links (review S4'): RENTALS_PUBLIC_BASE_URL when
 * set; otherwise production always uses https://galaxymind.space and never the per-deployment
 * VERCEL_URL; previews and local builds fall back to VERCEL_URL, then production.
 */
export const PRODUCTION_BASE_URL = "https://galaxymind.space";
export function publicBaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.RENTALS_PUBLIC_BASE_URL) return env.RENTALS_PUBLIC_BASE_URL;
  if (isProductionDeploy(env)) return PRODUCTION_BASE_URL;
  return env.VERCEL_URL ? `https://${env.VERCEL_URL}` : PRODUCTION_BASE_URL;
}
/** Pilot mode. Default ON: 7 day cap even though limits.ts allows 30. Off only with RENTALS_PILOT=0. */
export function pilotEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return pilotOn(env);
}
/**
 * Base mainnet. OFF by default and not set in any env. It turns on only when ALL of these are set
 * deliberately: RENTALS_MAINNET_ENABLED=1, RENTALS_X402_NETWORK=mainnet, the exact acknowledgement
 * RENTALS_PHASE2_MODE=mainnet, RENTALS_MAINNET_ACK=i-authorize-mainnet-1-dollar-test, and CDP_API_KEY_ID + CDP_API_KEY_SECRET.
 */
export const MAINNET_ACK = "i-authorize-mainnet-1-dollar-test";
export function mainnetEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RENTALS_PHASE2_MODE === "mainnet" && env.RENTALS_MAINNET_ENABLED === "1" && env.RENTALS_X402_NETWORK === "mainnet"
    && env.RENTALS_MAINNET_ACK === MAINNET_ACK && !!env.CDP_API_KEY_ID && !!env.CDP_API_KEY_SECRET;
}
/** Server-side bay allowlist (PILOT_RIG_ALLOWLIST="1,2,5"), filled from the node side. Bay numbers only, 1..999. */
export function rigAllowlist(env: Record<string, string | undefined> = process.env): number[] {
  const out: number[] = [];
  for (const t of (env.PILOT_RIG_ALLOWLIST ?? "").split(",")) {
    const s = t.trim();
    if (!/^\d{1,3}$/.test(s)) continue;
    const n = Number(s);
    if (n >= 1 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}
export function phase2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.RENTALS_PHASE2_ENABLED !== "1") return false;
  if (env.RENTALS_PHASE2_MODE === "staging") return true;
  // Mainnet mode only behind every mainnet gate (off by default, not set in any env).
  return env.RENTALS_PHASE2_MODE === "mainnet" && mainnetEnabled(env);
}
/** Signed-job env follows the mode. */
export function jobEnv(env: Record<string, string | undefined> = process.env): "staging" | "mainnet" {
  return env.RENTALS_PHASE2_MODE === "mainnet" && mainnetEnabled(env) ? "mainnet" : "staging";
}
