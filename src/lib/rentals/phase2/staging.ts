/**
 * Staging wiring for the MCP route. Mock providers and an in-memory store
 * only (per-instance, non-durable: fine for a preview, never for money).
 * Pricing: RENTALS_PHASE2_STAGING_PRICING override, else the live pricing_daily
 * row read-only via RENTALS_SUPABASE_*. Missing or stale = fail closed.
 */
import { MemoryStore, type RentalStore } from "./store";
import { SupabaseStore } from "./store-supabase";
import { X402Provider, x402Net } from "./x402";
import { PAYTO_PIN_SHA256, evmPayToFromEnv, type PayToPins } from "./payto-pins";
import { MockAlerter, NtfyAlerter, Limiter, killSwitchFrom, supabaseFlagReader } from "./safety";
import { MockProvider } from "./providers";
import { payCapacity, type Deps } from "./service";
import { lightningEnabled, pilotEnabled, rigAllowlist, jobEnv, publicBaseUrl } from "./flag";
import { loadPricingDaily, SQL_COMMIT_CAP, type DailyPricing } from "./pricing";
import { liveBtcUsd } from "./btcusd";
import { mainnetEnabled } from "./flag";
import { solanaFromEnv } from "./solana";
import { BASE_SEPOLIA } from "./x402";
import { wireEth } from "./eth/wire";
import { ethClaimPending } from "./eth/service";
import { btcFlag, btcConfig, btcProfile, BTC_PUBLIC_TIP_URLS } from "./btc/config";
import { MemoryBtcStore, SupabaseBtcStore, type BtcStore } from "./btc/store";
import { loadBtcPricingRows } from "./btc/quote";
import { publicTip } from "./btc/tip";

/** An alerter that relies on the rental_alerts outbox (written in every commit) being relayed by the node. */
export class OutboxOnlyAlerter extends MockAlerter {}

/**
 * Mainnet refuses to start (null = phase2 off) unless every production dependency is real:
 * Supabase store, real alerter (ntfy URL, or RENTALS_ALERTS_OUTBOX=1 = node relays rental_alerts),
 * a non-staging kid, live BTC/USD, and a mainnet payNetwork. Returns the reason for tests/logs.
 */
export function mainnetRefusal(d: Deps, env: Record<string, string | undefined>): string | null {
  if (!(d.store instanceof SupabaseStore)) return "memory_store";
  if (d.alerter instanceof MockAlerter && !(d.alerter instanceof OutboxOnlyAlerter)) return "mock_alerter";
  // Outbox-only alerts need the node relay confirmed live (set RENTALS_OUTBOX_FORWARDER_READY=1 only after the relay test).
  if (d.alerter instanceof OutboxOnlyAlerter && env.RENTALS_OUTBOX_FORWARDER_READY !== "1") return "outbox_forwarder_not_ready";
  if (!env.RENTALS_JOB_SIGNING_KID || /staging/i.test(d.signingKid)) return "staging_kid";
  if (!d.payNetwork || d.payNetwork === BASE_SEPOLIA.network) return "sepolia_network";
  if (d.jobEnv !== "mainnet") return "job_env";
  if (env.RENTALS_X402_FACILITATOR === "mock") return "mock_facilitator";
  return null;
}

/**
 * RENTALS_DB_COMMIT_CAP, clamped to SQL_COMMIT_CAP (the rental_settle SQL cap). A typo'd env above the DB cap would
 * otherwise sell rigs the DB refuses (paid, then manually refunded). security review #106 N1. SQL_COMMIT_CAP is raised only
 * alongside the migration that raises the DB cap.
 */
export function dbCommitCap(env: Record<string, string | undefined>): number {
  const n = Number((env.RENTALS_DB_COMMIT_CAP ?? "").trim());
  return Number.isInteger(n) && n >= 1 ? Math.min(n, SQL_COMMIT_CAP) : SQL_COMMIT_CAP;
}

/**
 * Review #106 N2: pricing_daily is read at most once per PRICING_CACHE_MS per instance (public quote routes call
 * getQuote on every request). Only a good row is cached; a miss or error is re-read next call (still fails closed).
 */
export const PRICING_CACHE_MS = 60_000;
let pricingCache: { at: number; v: DailyPricing } | null = null;
async function cachedPricingDaily(env: Record<string, string | undefined>): Promise<DailyPricing | null> {
  const t = Date.now();
  if (pricingCache && t - pricingCache.at >= 0 && t - pricingCache.at < PRICING_CACHE_MS) return pricingCache.v;
  const v = await loadPricingDaily(env);
  pricingCache = v ? { at: t, v } : null;
  return v;
}
let cached: Deps | null = null;
export function stagingDeps(env: Record<string, string | undefined> = process.env, payToPins: PayToPins = PAYTO_PIN_SHA256): Deps | null {
  // payTo = RENTALS_PAYTO_PIN_EVM, used only when it is exact EIP-55, non-zero and hashes to the code pin (payto-pins.ts).
  // Unset or refused = no staging deps. A stale override env that differs (exact compare) refuses to start.
  const payTo = evmPayToFromEnv(env, payToPins.evm);
  if (!payTo) return null;
  if (env.RENTALS_X402_PAYTO_TEST && env.RENTALS_X402_PAYTO_TEST !== payTo) return null;
  if (cached) return cached;
  const key = env.RENTALS_JOB_SIGNING_KEY_PEM, hk = env.RENTALS_CODE_HMAC_KEY;
  if (!key || !hk) return null;
  const parse = (): DailyPricing | null => { try { return JSON.parse(env.RENTALS_PHASE2_STAGING_PRICING ?? "null"); } catch { return null; } };
  // Persistent store on the staging project when the service key is present (works across instances).
  const sbUrl = env.RENTALS_PHASE2_SUPABASE_URL ?? "", sbKey = env.RENTALS_PHASE2_SUPABASE_SERVICE_KEY ?? "";
  const store: RentalStore = sbUrl && sbKey ? new SupabaseStore(sbUrl, sbKey) : new MemoryStore();
  const base = publicBaseUrl(env); // production never falls back to VERCEL_URL (S4')
  // BTC on-chain rail (RENTALS_BTC_ONCHAIN_ENABLED=1 only). Flag off = not wired at all: no hold, no routes, no UI.
  const btcStore: BtcStore | null = btcFlag(env) ? (store instanceof SupabaseStore ? new SupabaseBtcStore(sbUrl, sbKey, store) : new MemoryBtcStore(store as MemoryStore)) : null;
  // While a live BTC binding exists, USDC refuses money for that order (fail closed on a read error).
  // Same for an Ethereum transfer still confirming (review #108 S5), composed in once wireEth has run (below). Each
  // side fails closed on its own read error. BTC and ETH binds also refuse each other (bindEth / createBtcBinding).
  let ethHold: ((orderId: string) => Promise<boolean>) | null = null;
  const otherRailHold = async (orderId: string) => {
    if (btcStore) { try { if (await btcStore.hasLiveBinding(orderId)) return true; } catch { return true; } }
    return ethHold ? ethHold(orderId) : false;
  };
  let x402: X402Provider | MockProvider;
  try { x402 = env.RENTALS_X402_FACILITATOR === "mock" ? new MockProvider("x402_usdc", payTo) : new X402Provider({ net: x402Net(env), payTo, payToPins, resourceBase: base, store, cdp: { keyId: env.CDP_API_KEY_ID ?? "", secret: env.CDP_API_KEY_SECRET ?? "" }, solana: solanaFromEnv(env, mainnetEnabled(env), payToPins) ?? undefined, otherRailHold }); }
  catch { return null; } // mainnet requested but refused in this build
  cached = {
    store,
    payToPins,
    // USDC via x402 on Base Sepolia only. Lightning is wired only when RENTALS_LIGHTNING_ENABLED=1.
    providers: { ...(lightningEnabled(env) ? { lightning: new MockProvider("lightning") } : {}), x402_usdc: x402 },
    lightningEnabled: lightningEnabled(env),
    pilot: pilotEnabled(env),
    jobEnv: jobEnv(env),
    payNetwork: x402 instanceof X402Provider ? x402.caip2 : x402Net(env).network,
    bays: rigAllowlist(env), // PILOT_RIG_ALLOWLIST; empty = no capacity. Expanding the fleet = adding bays here.
    dbCommitCap: dbCommitCap(env),
    pricing: async () => parse() ?? (await cachedPricingDaily(env)), // read-only; never writes
    // Mainnet: live Coinbase+Kraken, cross-checked (<=4%). The static staging rate is never read in mainnet mode.
    btcUsd: mainnetEnabled(env) ? liveBtcUsd() : async () => Number(env.RENTALS_PHASE2_STAGING_BTCUSD ?? "NaN"),
    now: () => Date.now(),
    signingKeyPem: key.replace(/\\n/g, "\n"),
    signingKid: env.RENTALS_JOB_SIGNING_KID ?? "staging-1",
    codeHmacKey: hk,
    // Kill switch: env OR Supabase rental_settings.rentals_enabled (unreadable = killed).
    // Kill switch reads only the real flag row. No env var can bypass it.
    killSwitch: killSwitchFrom(env, supabaseFlagReader(env)),
    alerter: env.RENTALS_NTFY_URL ? new NtfyAlerter(env.RENTALS_NTFY_URL, env.RENTALS_NTFY_TOPIC ?? "gm-alerts", env.RENTALS_NTFY_TOKEN) : env.RENTALS_ALERTS_OUTBOX === "1" ? new OutboxOnlyAlerter() : new MockAlerter(),
    limiter: { global: new Limiter(600, 60_000), perKey: new Limiter(30, 60_000) },
    // B7: bay availability gate (G1-G4). OFF unless RENTALS_AVAIL_GATE=1 (only after the node AVAIL1 kit reports).
    availGate: env.RENTALS_AVAIL_GATE === "1",
    ...(btcStore ? { btc: {
      store: btcStore,
      config: () => btcConfig(env),
      pricingRows: () => loadBtcPricingRows(env), // read-only, the two newest rows with day
      publicTip: () => publicTip(BTC_PUBLIC_TIP_URLS[btcProfile(env)]),
    } } : {}),
  };
  // B7 G3: re-check free bays before any facilitator call (gate off = always ok; errors = no capacity).
  if (x402 instanceof X402Provider) { const deps = cached; x402.setCapacityGuard(async (ref) => (await payCapacity(deps, ref)) === "ok"); }
  if (mainnetEnabled(env) && mainnetRefusal(cached, env)) { cached = null; return null; }
  // Ethereum USDC direct-transfer rail: lookup for eth_ refs always; bind/claim/sweep hold only when fully configured.
  const ee = wireEth(cached, env);
  if (ee) ethHold = (orderId) => ethClaimPending(ee, orderId);
  return cached;
}
