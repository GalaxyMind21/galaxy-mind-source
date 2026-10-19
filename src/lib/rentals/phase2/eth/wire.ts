/**
 * Wires the Ethereum USDC rail onto the phase-2 Deps (called once from stagingDeps).
 *  - Read side, always (when the ETH store exists): lookup for eth_ refs (a recorded settlement keeps reading as paid
 *    with the flag off), the sweep hold, and claim resolution whenever an allowlisted RPC is configured.
 *  - Money side (new quotes) only when ethConfig() is complete, which includes RENTALS_ETH_PAYTO passing the sha256 pin.
 *  - Cross-rail guard (review #108 S5): while an Ethereum transfer for an order is confirming, that order's x402
 *    (Base/Solana) refs are not payable and the payment-request GET answers 503 payment_pending. Fails closed on a read
 *    error; a store with no ETH schema at all (rail not migrated) adds nothing.
 */
import { X402Provider } from "../x402";
import { SupabaseStore } from "../store-supabase";
import { MemoryStore } from "../store";
import type { Deps } from "../service";
import { ETH_PAYTO_HISTORY, ethConfig, ethVerifyConfig, isEthRef, ethPinFromEnv } from "./config";
import { PAYTO_PIN_SHA256 } from "../payto-pins";
import { makeRpc } from "./verify";
import { MemoryEthStore, SupabaseEthStore, type EthStore } from "./store";
import { ethBlocksBtc, ethClaimPending, ethExpiryHold, ethHeldOrders, ethLookup, type EthDeps } from "./service";

type Env = Record<string, string | undefined>;
const wired = new WeakMap<Deps, EthDeps>();
/** The Ethereum deps for these phase-2 deps, or null when not wired. */
export const ethDepsOf = (d: Deps | null | undefined): EthDeps | null => (d ? wired.get(d) ?? null : null);

export function wireEth(d: Deps, env: Env = process.env, fetchImpl?: typeof fetch, opts: { pinSha?: string | null; pinHistory?: readonly string[] } = {}): EthDeps | null {
  const sbUrl = env.RENTALS_PHASE2_SUPABASE_URL ?? "", sbKey = env.RENTALS_PHASE2_SUPABASE_SERVICE_KEY ?? "";
  let store: EthStore | null = null;
  if (d.store instanceof SupabaseStore && sbUrl && sbKey) store = new SupabaseEthStore(sbUrl, sbKey, fetchImpl);
  else if (d.store instanceof MemoryStore) store = new MemoryEthStore(d.store);
  if (!store) return null;
  const pinSha = opts.pinSha === undefined ? PAYTO_PIN_SHA256.evm : opts.pinSha;
  const pin = ethPinFromEnv(env, pinSha);
  let cfg = ethConfig(env, pinSha);
  let v = ethVerifyConfig(env);
  // Mainnet money needs the durable store.
  if (!(d.store instanceof SupabaseStore)) { if (cfg && !cfg.net.testnet) cfg = null; if (v && !v.net.testnet) v = null; }
  const e: EthDeps = { store, cfg, net: v?.net ?? null, rpc: v ? makeRpc(v.rpc, fetchImpl) : null, pin, pinHistory: opts.pinHistory ?? ETH_PAYTO_HISTORY, now: d.now };
  wired.set(d, e);
  const xp = d.providers.x402_usdc;
  if (xp instanceof X402Provider) {
    const base = xp.lookup.bind(xp);
    xp.lookup = (ref: string) => (isEthRef(ref) ? ethLookup(d.store, d, e, ref) : base(ref));
    const orderOf = async (ref: string) => (await d.store.getBinding(ref))?.orderId ?? null;
    const payable = xp.payableState.bind(xp);
    xp.payableState = async (ref: string) => {
      const st = await payable(ref);
      if (st !== "payable") return st;
      try { const oid = await orderOf(ref); return oid && (await ethClaimPending(e, oid)) ? ("not_payable" as const) : st; } catch { return "error" as const; }
    };
    const reqStatus = xp.requestStatus.bind(xp);
    xp.requestStatus = async (ref: string) => {
      const r = await reqStatus(ref);
      // A pending ETH claim makes payableState "not_payable" (above), so the 409 is checked too: it must read as pending, not dead.
      if (r.status !== 402 && !(r.status === 409 && r.body.error === "order_not_payable")) return r;
      try { const oid = await orderOf(ref); if (oid && (await ethClaimPending(e, oid))) return { status: 503 as const, body: { error: "payment_pending" } }; }
      catch { return { status: 503 as const, body: { error: "store_unavailable" } }; }
      return r;
    };
  }
  // Compose, never replace: any hold already installed still holds (OR). A hold that throws holds (fail closed). The BTC
  // hold lives inside sweepExpired itself (live binding), so both apply either way.
  const prior = d.expiryHold;
  d.expiryHold = async (o) => (prior ? await prior(o).catch(() => true) : false) || ethExpiryHold(e, o);
  d.btcBlockedByOtherRail = (orderId) => ethBlocksBtc(e, orderId);
  // B7: Ethereum claims still confirming hold their rigs under the availability gate, like BTC (SF8).
  // S3 (review #108 R4, folded into the MRR-only PR from #116): only when Ethereum is configured (money side or read
  // side). With the rail off, an ETH read error can never block Base, Solana or BTC checkout.
  if (e.cfg || e.net) d.railHeldOrders = () => ethHeldOrders(e);
  return e;
}
