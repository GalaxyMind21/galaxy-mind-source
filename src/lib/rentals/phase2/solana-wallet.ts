/**
 * Human checkout on Solana (/hashrate/rent) · pure helpers + Wallet Standard discovery.
 * No Node imports, so the client bundle can use it (solana-tx.ts uses @noble only).
 *
 * The page builds the x402 "exact" SVM transaction itself from the PaymentRequired that
 * GET /api/rentals/pay/<ref> returns (ComputeBudget limit + price, spl-token TransferChecked of
 * EXACTLY the amount into payTo's USDC account, Memo = the order's rental ID), asks the wallet to
 * sign it (solana:signTransaction: the payer's partial signature; the facilitator pays the fee and
 * signs last), and posts it back. The server re-checks everything (solana.ts) before any money moves.
 * Refused BEFORE the wallet is asked: a requirement whose network, payTo or USDC mint differs from
 * the values the page was rendered with, or whose memo is not this order's rental ID.
 */
import { buildPaymentTx, isPubkey, isSolanaSig } from "./solana-tx";
import type { PaymentRequiredBody } from "./human-wallet";

export type SolanaChain = { network: string; walletChain: "solana:mainnet" | "solana:devnet"; name: string; explorer: string; testnet: boolean; payTo: string; asset: string };
export type SolanaRequirement = {
  scheme: "exact"; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number;
  extra: { orderRef: string; feePayer: string; memo: string; decimals?: number; recentBlockhash?: string; lastValidBlockHeight?: string };
};

/** The Solana requirement this page may pay, or why not. */
export function pickSolanaRequirement(pr: unknown, expect: SolanaChain, rentalId: string): { ok: true; req: SolanaRequirement } | { ok: false; error: "bad_request" | "wrong_network" | "pinned_mismatch" } {
  const b = pr as PaymentRequiredBody | null;
  const all = b && b.x402Version === 2 && Array.isArray(b.accepts) ? (b.accepts as unknown as SolanaRequirement[]) : [];
  const r = all.find((a) => a?.scheme === "exact" && a?.network === expect.network);
  if (!r) return { ok: false, error: all.some((a) => String(a?.network ?? "").startsWith("solana:")) ? "wrong_network" : "bad_request" };
  const x = r.extra ?? ({} as SolanaRequirement["extra"]);
  if (!/^[1-9]\d{0,15}$/.test(String(r.amount)) || !isPubkey(r.payTo) || !isPubkey(r.asset) || !isPubkey(x.feePayer) || !(r.maxTimeoutSeconds > 0)) return { ok: false, error: "bad_request" };
  if (r.payTo !== expect.payTo || r.asset !== expect.asset) return { ok: false, error: "pinned_mismatch" };
  if (x.memo !== rentalId || x.orderRef !== rentalId || x.feePayer === r.payTo) return { ok: false, error: "pinned_mismatch" };
  return { ok: true, req: r };
}

/** Unsigned tx (base64-free bytes) for the wallet to sign. Throws no_blockhash when the 402 had no usable hint. */
export function buildSolanaPayment(req: SolanaRequirement, payer: string): Uint8Array {
  const bh = req.extra.recentBlockhash;
  if (!isPubkey(bh)) throw new Error("no_blockhash");
  if (!isPubkey(payer) || payer === req.extra.feePayer) throw new Error("bad_payer");
  return buildPaymentTx({ feePayer: req.extra.feePayer, payer, mint: req.asset, payTo: req.payTo, amount: BigInt(req.amount), decimals: 6, memo: req.extra.memo, recentBlockhash: bh });
}

const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
/** The x402 v2 payload for POST /api/rentals/pay/<ref> (header PAYMENT-SIGNATURE, base64 JSON). `accepted` is the requirement as served, minus the blockhash hints. */
export function solanaPaymentHeader(pr: PaymentRequiredBody, req: SolanaRequirement, signedTx: Uint8Array): string {
  const { recentBlockhash: _a, lastValidBlockHeight: _b, ...extra } = req.extra;
  void _a; void _b;
  const payload = { x402Version: 2, resource: pr.resource, accepted: { ...req, extra }, payload: { transaction: b64(signedTx) } };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

/** Solana explorer link for a settled signature, or null. */
export function solanaTxLink(chain: SolanaChain, tx: unknown): string | null {
  return isSolanaSig(tx) ? `${chain.explorer}/tx/${tx}${chain.testnet ? "?cluster=devnet" : ""}` : null;
}

// ── Wallet Standard (Phantom, Solflare, Backpack, ...) without @solana/web3.js ──
type WsAccount = { address: string; publicKey: Uint8Array; chains: readonly string[]; features: readonly string[] };
type WsWallet = {
  name: string; icon: string; chains: readonly string[]; accounts: readonly WsAccount[];
  features: Record<string, unknown> & {
    "standard:connect"?: { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WsAccount[] }> };
    "solana:signTransaction"?: { supportedTransactionVersions?: readonly (number | "legacy")[]; signTransaction(...inputs: { account: WsAccount; transaction: Uint8Array; chain?: string }[]): Promise<readonly { signedTransaction: Uint8Array }[]> };
  };
};
export type SolanaWalletOpt = { id: string; name: string; icon: string; wallet: WsWallet };

/** True when a Wallet Standard wallet can sign a v0 transaction on this chain. */
export function canPay(w: WsWallet, chain: SolanaChain["walletChain"]): boolean {
  const st = w?.features?.["solana:signTransaction"];
  if (!st || typeof st.signTransaction !== "function" || typeof w.features["standard:connect"]?.connect !== "function") return false;
  const v = st.supportedTransactionVersions;
  if (v && !v.includes(0)) return false;
  return !Array.isArray(w.chains) || w.chains.length === 0 || w.chains.includes(chain);
}

/** Discover Wallet Standard wallets (the app-ready / register-wallet events). Returns a stop() function. */
export function discoverSolanaWallets(chain: SolanaChain["walletChain"], onChange: (list: SolanaWalletOpt[]) => void): () => void {
  const found = new Map<string, SolanaWalletOpt>();
  const register = (...ws: WsWallet[]) => {
    for (const w of ws) {
      if (!w?.name || !canPay(w, chain)) continue;
      const id = w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
      if (!found.has(id)) found.set(id, { id, name: w.name.slice(0, 40), icon: typeof w.icon === "string" && /^data:image\/(svg\+xml|png|webp);/.test(w.icon) ? w.icon : "", wallet: w });
    }
    onChange([...found.values()]);
    return () => {};
  };
  const api = Object.freeze({ register });
  const onRegister = (e: Event) => { try { (e as CustomEvent<(a: typeof api) => void>).detail?.(api); } catch { /* ignore a bad wallet */ } };
  window.addEventListener("wallet-standard:register-wallet", onRegister);
  try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api })); } catch { /* ignore */ }
  return () => window.removeEventListener("wallet-standard:register-wallet", onRegister);
}

/** Connect and return the account to pay from. */
export async function connectSolana(opt: SolanaWalletOpt, chain: SolanaChain["walletChain"]): Promise<WsAccount> {
  const r = await opt.wallet.features["standard:connect"]!.connect();
  const acc = (r?.accounts ?? opt.wallet.accounts ?? []).find((a) => isPubkey(a?.address) && (!a.chains?.length || a.chains.includes(chain)));
  if (!acc) throw { code: 4001 };
  return acc;
}

/** Ask the wallet for the payer's signature. Returns the signed transaction bytes (sponsor slot still empty). */
export async function signSolana(opt: SolanaWalletOpt, account: WsAccount, tx: Uint8Array, chain: SolanaChain["walletChain"]): Promise<Uint8Array> {
  const out = await opt.wallet.features["solana:signTransaction"]!.signTransaction({ account, transaction: tx, chain });
  const s = out?.[0]?.signedTransaction;
  if (!(s instanceof Uint8Array) || s.length < 100 || s.length > 1232) throw new Error("bad_signed_tx");
  return s;
}
