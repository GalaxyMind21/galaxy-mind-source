/**
 * x402 v2 "exact" on Solana (USDC, SPL TransferChecked). Spec: x402 specs/schemes/exact/scheme_exact_svm.md.
 * Staging: Solana devnet via the x402.org facilitator (free, no key). Mainnet: the CDP facilitator,
 * same JWT as Base, only when mainnetEnabled() AND RENTALS_SOLANA_ENABLED=1.
 *
 * Money is accepted only when ALL hold (stricter than the spec, which tolerates overpayment):
 *  1. Pre-verify decode of the client's partially signed tx (before any facilitator call): our static
 *     layout only (ComputeBudget limit, ComputeBudget price, spl-token TransferChecked, then Memo /
 *     Lighthouse), no address-lookup tables, exactly 2 required signers (sponsor feePayer + payer),
 *     feePayer = the facilitator's pinned sponsor and referenced by no instruction, the transfer moves
 *     EXACTLY the bound amount of the pinned mint into payTo's associated token account, the
 *     authority is the payer (never the sponsor), exactly one Memo whose UTF-8 text is the orderRef
 *     we bound to this ref, and the payer's ed25519 signature over the message is valid.
 *  2. The accepted requirement matches the stored one (scheme, network, amount, asset, payTo, extra.memo,
 *     extra.feePayer, extra.orderRef), exactly.
 *  3. Facilitator /verify valid, the order is still payable, /settle success with a base58 signature.
 *  4. Independent on-chain check (our RPC, getTransaction jsonParsed at "finalized"): no error; the
 *     confirmed tx carries the payer's exact signature from step 1 (ties chain to payload); exactly one
 *     token transfer touches payTo's token account across top-level and inner instructions, and it is a
 *     TransferChecked of the pinned mint for EXACTLY the amount by the payer; exactly one memo equal to
 *     the orderRef; and the token-balance delta of payTo's account is EXACTLY the amount.
 */
import type { X402Requirements } from "./providers";
import { cdpJwt, type PayError } from "./x402";
import { PAYTO_PIN_SHA256, payToProblem, payToMismatch, solanaPayToFromEnv, type PayToPins } from "./payto-pins";
import {
  parseTransaction, associatedTokenAddress, b58encode, isPubkey, isSolanaSig, verifySignature, readU64, readU32,
  TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, LIGHTHOUSE_PROGRAM, type ParsedTx,
} from "./solana-tx";

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type SolanaNet = { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" | "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; asset: string; decimals: 6; facilitator: string; rpc: string; env: "testnet" | "mainnet"; auth: "none" | "cdp" };
/** USDC mint on Solana mainnet, verified on-chain (spl-token mint, decimals 6): src/lib/rentals/phase2/onchain/solana-mainnet-usdc.json. */
export const SOLANA_MAINNET: SolanaNet = { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, facilitator: "https://api.cdp.coinbase.com/platform/v2/x402", rpc: "https://api.mainnet-beta.solana.com", env: "mainnet", auth: "cdp" };
/** Circle's devnet USDC. Staging only. */
export const SOLANA_DEVNET: SolanaNet = { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6, facilitator: "https://x402.org/facilitator", rpc: "https://api.devnet.solana.com", env: "testnet", auth: "none" };

/** Sponsor caps (spec §2.2.1 reference defaults; the facilitator may be stricter). */
export const MAX_CU_LIMIT = 400_000;
export const MAX_CU_PRICE_MICROLAMPORTS = BigInt(5_000_000); // 5 lamports / CU (spec §3.1 fast path)
/** Review #101 S1: the on-chain check reads at "finalized" (no rollback risk), not "confirmed". */
export const SOLANA_COMMITMENT = "finalized" as const;
/** Default time the pay request waits for finalization (~13 s after confirmed, usually). A miss is re-checked by polls (pending settlement). */
export const SOLANA_FINALIZE_DEADLINE_MS = 40_000;
/** SF5: the whole Solana pay request (verify + settle + on-chain wait) stays under this; the route has maxDuration = 60. */
export const SOLANA_PAY_BUDGET_MS = 50_000;
/** #103 B2: a pending row is only "dropped" once the finalized height is this many blocks PAST its lastValidBlockHeight bound. */
export const DROP_MARGIN_BLOCKS = 150;
/** Review #101 S6: blockhash hint cache per RPC, so GET /pay can't be used to hammer the RPC. */
export const BLOCKHASH_CACHE_MS = 20_000;
const blockhashCache = new Map<string, { at: number; v: Promise<{ recentBlockhash: string; lastValidBlockHeight: string } | null> }>();
/** Test hook. */
export function clearBlockhashCache() { blockhashCache.clear(); }

export type SolanaPayload = { x402Version: 2; accepted: Record<string, unknown>; payload: { transaction: string }; resource?: unknown; extensions?: unknown };
type Pre = { ok: true; payer: string; payerSig: string } | { ok: false; error: PayError };

const MEMO_MAX = 256;
const dec = new TextDecoder("utf-8", { fatal: true });

export class SolanaExact {
  private feePayerCache: { v: string; at: number } | null = null;
  constructor(private o: { net: SolanaNet; payTo: string; fetchImpl?: typeof fetch; now?: () => number; rpcDeadlineMs?: number; sleep?: (ms: number) => Promise<void>; cdp?: { keyId: string; secret: string }; feePayerPin?: string; payToPins?: PayToPins }) {
    // payTo comes from env (payto-pins.ts solanaPayToFromEnv): a 32-byte base58 key whose sha256 equals the code pin.
    const payToBad = payToProblem("solana", o.payTo, (o.payToPins ?? PAYTO_PIN_SHA256).solana);
    if (payToBad || !isPubkey(o.payTo)) { if (payToBad) payToMismatch("solana", payToBad); throw new Error("bad_solana_payto"); }
    if (o.net.auth === "cdp" && !(o.cdp?.keyId && o.cdp?.secret)) throw new Error("cdp_credentials_missing");
    if (!isPubkey(o.net.asset)) throw new Error("bad_solana_asset");
    if (o.feePayerPin !== undefined && o.feePayerPin !== "" && !isPubkey(o.feePayerPin)) throw new Error("bad_fee_payer_pin");
  }
  get network() { return this.o.net.network; }
  /** #103 S7: mainnet Solana fails closed unless the pending-signature schema is in place. */
  get mainnet() { return this.o.net.env === "mainnet"; }
  get payTo() { return this.o.payTo; }
  get asset() { return this.o.net.asset; }
  /** payTo's associated USDC token account: the only destination we accept. */
  get payToAta() { return associatedTokenAddress(this.o.payTo, this.o.net.asset); }
  private f() { return this.o.fetchImpl ?? fetch; }
  private now() { return (this.o.now ?? Date.now)(); }

  private headers(method: "GET" | "POST", url: string): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.o.net.auth === "cdp") h.authorization = `Bearer ${cdpJwt(this.o.cdp!.keyId, this.o.cdp!.secret, method, url, Math.floor(this.now() / 1000))}`;
    return h;
  }

  /** The facilitator's Solana sponsor (extra.feePayer from GET /supported), cached 10 min. A pin that differs = Solana off. */
  async feePayer(): Promise<string | null> {
    if (this.feePayerCache && this.now() - this.feePayerCache.at < 600_000) return this.feePayerCache.v;
    const url = `${this.o.net.facilitator}/supported`;
    try {
      const res = await this.f()(url, { method: "GET", headers: this.headers("GET", url), cache: "no-store", signal: AbortSignal.timeout(8_000) });
      const j = (await res.json().catch(() => ({}))) as { kinds?: { x402Version?: number; scheme?: string; network?: string; extra?: { feePayer?: unknown } }[] };
      const k = (j.kinds ?? []).find((x) => x.x402Version === 2 && x.scheme === "exact" && x.network === this.o.net.network);
      const fp = k?.extra?.feePayer;
      if (!isPubkey(fp) || fp === this.o.payTo) return null;
      if (this.o.feePayerPin && fp !== this.o.feePayerPin) return null;
      this.feePayerCache = { v: fp, at: this.now() };
      return fp;
    } catch { return null; }
  }

  /** The Solana requirement for one order (memo = orderRef). null = Solana not offered right now (fail closed). */
  async requirement(orderRef: string, amountAtomic: number, resource?: string): Promise<X402Requirements | null> {
    const memo = orderRef;
    if (!memo || new TextEncoder().encode(memo).length > MEMO_MAX) return null;
    const feePayer = await this.feePayer();
    if (!feePayer) return null;
    return {
      x402Version: 2, scheme: "exact", network: this.o.net.network, asset: this.o.net.asset, amount: String(amountAtomic), payTo: this.o.payTo,
      maxTimeoutSeconds: 900, extra: { orderRef, feePayer, memo, decimals: 6 } as X402Requirements["extra"], ...(resource ? { resource } : {}),
    };
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    try {
      // SF1: never follow a redirect (a keyed RPC URL must not bounce the request, or its key, elsewhere).
      const res = await this.f()(this.o.net.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
      return ((await res.json().catch(() => ({}))) as { result?: unknown }).result ?? null;
    } catch { return null; }
  }

  /** A fresh blockhash hint for the 402 (spec: extra.recentBlockhash). Not stored, not compared. */
  async latestBlockhash(): Promise<{ recentBlockhash: string; lastValidBlockHeight: string } | null> {
    // Cached (and single-flight) per RPC for BLOCKHASH_CACHE_MS: a blockhash stays valid for ~60 s, and every
    // GET /pay would otherwise cost one RPC call. A failed fetch is cached too, so errors don't stampede.
    const key = this.o.net.rpc, hit = blockhashCache.get(key), t = this.now();
    if (hit && t - hit.at >= 0 && t - hit.at < BLOCKHASH_CACHE_MS) return hit.v;
    const v = (async () => {
      const r = (await this.rpc("getLatestBlockhash", [{ commitment: "confirmed" }])) as { value?: { blockhash?: string; lastValidBlockHeight?: number } } | null;
      const bh = r?.value?.blockhash, h = r?.value?.lastValidBlockHeight;
      return isPubkey(bh) && Number.isSafeInteger(h) ? { recentBlockhash: bh, lastValidBlockHeight: String(h) } : null;
    })();
    blockhashCache.set(key, { at: t, v });
    if (blockhashCache.size > 8) blockhashCache.delete(blockhashCache.keys().next().value as string);
    return v;
  }

  /** Newest lastValidBlockHeight right now (processed, uncached): an upper bound for any tx signed before this call. */
  async lastValidUpperBound(): Promise<string | null> {
    const r = (await this.rpc("getLatestBlockhash", [{ commitment: "processed" }])) as { value?: { lastValidBlockHeight?: number } } | null;
    const h = r?.value?.lastValidBlockHeight;
    return Number.isSafeInteger(h) && (h as number) > 0 ? String(h) : null;
  }

  /**
   * FB1: is this signature definitely never landing? Only when getSignatureStatuses (searchTransactionHistory) knows
   * nothing of it AND the finalized block height is more than DROP_MARGIN_BLOCKS past the tx's lastValidBlockHeight
   * bound (#103 B2: margin for RPC lag / forks). Any RPC doubt = "unknown".
   */
  async dropStatus(sig: string, lastValidBlockHeight: string | null): Promise<"dropped" | "seen" | "unknown"> {
    if (!isSolanaSig(sig)) return "unknown";
    const st = (await this.rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: true }])) as { value?: unknown[] } | null;
    if (!st || !Array.isArray(st.value) || st.value.length !== 1) return "unknown";
    if (st.value[0] !== null) return "seen";
    if (!lastValidBlockHeight || !/^[1-9][0-9]{0,15}$/.test(lastValidBlockHeight)) return "unknown";
    const hgt = await this.rpc("getBlockHeight", [{ commitment: "finalized" }]);
    if (typeof hgt !== "number" || !Number.isSafeInteger(hgt)) return "unknown";
    return BigInt(hgt) > BigInt(lastValidBlockHeight) + BigInt(DROP_MARGIN_BLOCKS) ? "dropped" : "unknown";
  }

  /** Step 1: decode and check the partially signed tx against the stored requirement. Pure (no network). */
  preVerify(h: X402Requirements, p: SolanaPayload): Pre {
    const bad = (error: PayError): Pre => ({ ok: false, error });
    const ex = (h.extra ?? {}) as { orderRef?: string; feePayer?: string; memo?: string };
    if (h.network !== this.o.net.network || h.asset !== this.o.net.asset || h.payTo !== this.o.payTo) return bad("requirements_mismatch");
    if (!isPubkey(ex.feePayer) || typeof ex.memo !== "string" || !ex.memo || ex.memo !== ex.orderRef) return bad("requirements_mismatch");
    const b64 = p?.payload?.transaction;
    if (p?.x402Version !== 2 || typeof b64 !== "string" || b64.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return bad("invalid_payload");
    let tx: ParsedTx;
    try { tx = parseTransaction(Uint8Array.from(Buffer.from(b64, "base64"))); } catch { return bad("invalid_payload"); }
    if (tx.lookups !== 0) return bad("invalid_payload");                         // every account must be visible (spec §2.1.2)
    if (tx.numRequiredSignatures !== 2 || tx.numReadonlySigned !== 0) return bad("invalid_payload"); // sponsor + payer only (§2.1.4)
    const [feePayer, payer] = tx.accountKeys;
    if (feePayer !== ex.feePayer) return bad("requirements_mismatch");
    if (!payer || payer === feePayer || payer === this.o.payTo) return bad("invalid_payload");
    // Sponsor never referenced by any instruction (§2.1.1): not as an account, not as a program.
    if (tx.instructions.some((ix) => ix.programId === feePayer || ix.accounts.includes(feePayer))) return bad("invalid_payload");
    const ixs = tx.instructions;
    if (ixs.length < 4 || ixs.length > 7) return bad("invalid_payload");
    // [0] SetComputeUnitLimit, [1] SetComputeUnitPrice
    const [l, pr, t, ...rest] = ixs;
    if (l.programId !== COMPUTE_BUDGET_PROGRAM || l.accounts.length || l.data.length !== 5 || l.data[0] !== 2 || readU32(l.data, 1) > MAX_CU_LIMIT) return bad("invalid_payload");
    if (pr.programId !== COMPUTE_BUDGET_PROGRAM || pr.accounts.length || pr.data.length !== 9 || pr.data[0] !== 3 || readU64(pr.data, 1) > MAX_CU_PRICE_MICROLAMPORTS) return bad("invalid_payload");
    // [2] spl-token TransferChecked: source, mint, destination, authority. Exact amount, 6 decimals.
    if (t.programId !== TOKEN_PROGRAM || t.data.length !== 10 || t.data[0] !== 12 || t.accounts.length !== 4) return bad("invalid_payload");
    const [src, mint, dst, authority] = t.accounts;
    if (mint !== this.o.net.asset || t.data[9] !== this.o.net.decimals) return bad("requirements_mismatch");
    if (dst !== this.payToAta) return bad("wrong_payto");
    if (authority !== payer || src === dst || src === associatedTokenAddress(feePayer, mint)) return bad("invalid_payload");
    let want: bigint; try { want = BigInt(h.amount); } catch { return bad("requirements_mismatch"); }
    if (want <= BigInt(0) || readU64(t.data, 1) !== want) return bad("wrong_amount");
    // [3..6] Memo / Lighthouse only, exactly one Memo equal to the bound orderRef.
    let memos = 0;
    for (const ix of rest) {
      if (ix.programId === MEMO_PROGRAM) {
        memos++;
        let text = ""; try { text = dec.decode(ix.data); } catch { return bad("invalid_payload"); }
        if (text !== ex.memo || ix.accounts.some((a) => a !== payer)) return bad("requirements_mismatch");
      } else if (ix.programId !== LIGHTHOUSE_PROGRAM) return bad("invalid_payload");
    }
    if (memos !== 1) return bad("requirements_mismatch");
    // No other token instruction (only Memo / Lighthouse remain, and those cannot move tokens; wallets such as
    // Phantom may add Lighthouse balance assertions). Re-checked on-chain across inner instructions too.
    if (ixs.some((ix, i) => i !== 2 && (ix.programId === TOKEN_PROGRAM || ix.programId === TOKEN_2022_PROGRAM))) return bad("invalid_payload");
    // Payer signed exactly this message; sponsor slot still empty.
    if (!verifySignature(tx.signatures[1], tx.message, payer)) return bad("invalid_payload");
    if (tx.signatures[0].some((x) => x !== 0)) return bad("invalid_payload");
    return { ok: true, payer, payerSig: b58encode(tx.signatures[1]) };
  }

  /** Exact-match checks, pre-verify decode, facilitator verify + settle, then the independent on-chain check. No storage. */
  async verifyAndSettle(h: X402Requirements, expiresAt: number, p: SolanaPayload, beforeSettle?: () => Promise<boolean>, onSettled?: (s: { tx: string; payer: string; payerSig: string; lastValidBlockHeight: string | null }) => Promise<void>): Promise<{ ok: true; tx: string; onchain: number; payer: string } | { ok: false; error: PayError }> {
    if (this.now() > expiresAt) return { ok: false, error: "payment_expired" };
    const t0 = Date.now();
    const acc = (p?.accepted ?? {}) as Record<string, unknown>;
    for (const k of ["scheme", "network", "amount", "asset", "payTo"] as const) if (String(acc[k] ?? "") !== String(h[k])) return { ok: false, error: "requirements_mismatch" };
    const ae = (acc.extra ?? {}) as Record<string, unknown>, he = (h.extra ?? {}) as Record<string, unknown>;
    for (const k of ["orderRef", "feePayer", "memo"]) if (typeof he[k] !== "string" || ae[k] !== he[k]) return { ok: false, error: "requirements_mismatch" };
    const pre = this.preVerify(h, p);
    if (!pre.ok) return pre;
    // The facilitator sees our stored requirement (no blockhash hint), never the client's copy.
    const want = { scheme: h.scheme, network: h.network, amount: h.amount, asset: h.asset, payTo: h.payTo, maxTimeoutSeconds: h.maxTimeoutSeconds, extra: { feePayer: he.feePayer, memo: he.memo } };
    const body = JSON.stringify({ x402Version: 2, paymentPayload: { x402Version: 2, accepted: want, payload: { transaction: p.payload.transaction } }, paymentRequirements: want });
    const post = async (path: string) => {
      const url = `${this.o.net.facilitator}/${path}`;
      try {
        const res = await this.f()(url, { method: "POST", headers: this.headers("POST", url), body, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        return { status: res.status, j: (await res.json().catch(() => ({}))) as Record<string, unknown> };
      } catch { return { status: 0, j: {} as Record<string, unknown> }; }
    };
    const down = (st: number) => st === 0 || st >= 500;
    const v = await post("verify");
    if (v.j.isValid !== true) return { ok: false, error: down(v.status) ? "facilitator_unavailable" : "verify_failed" };
    if (beforeSettle && !(await beforeSettle())) return { ok: false, error: "order_not_payable" };
    const s = await post("settle");
    const tx = String(s.j.transaction ?? "");
    if (s.j.success !== true || !isSolanaSig(tx)) return { ok: false, error: down(s.status) ? "facilitator_unavailable" : "settle_failed" };
    // Review #101 F2: save the settled signature BEFORE the on-chain check, so a check that times out
    // (finalization can be slow) is re-checked by later polls instead of losing a payment that moved.
    // FB1: an UPPER bound for the tx's lastValidBlockHeight (its blockhash is no newer than the newest one now), so a
    // pending row is only ever resolved as dropped once that height has passed at finalized. null = never auto-drop.
    if (onSettled) { try { await onSettled({ tx, payer: pre.payer, payerSig: pre.payerSig, lastValidBlockHeight: await this.lastValidUpperBound() }); } catch { /* the caller alerts; the check still runs */ } }
    const left = Math.max(0, Math.min(this.o.rpcDeadlineMs ?? SOLANA_FINALIZE_DEADLINE_MS, SOLANA_PAY_BUDGET_MS - (Date.now() - t0)));
    const onchain = await this.checkOnchain(tx, h, pre.payer, pre.payerSig, left);
    if (!onchain) return { ok: false, error: "onchain_check_failed" };
    return { ok: true, tx, onchain, payer: pre.payer };
  }

  /** Independent on-chain check. Returns the exact amount, or 0. */
  async checkOnchain(sig: string, h: X402Requirements, payer: string, payerSig: string | null, deadlineMs?: number): Promise<number> {
    return (await this.inspectOnchain(sig, h, payer, payerSig, deadlineMs)).amount;
  }

  /**
   * checkOnchain with the reason split out (#103 S3): failed = the tx IS finalized (signature 0 = sig) but carries an
   * error, so no token moved and it never will (terminal failed_onchain). Everything else that isn't a pass is amount 0.
   */
  async inspectOnchain(sig: string, h: X402Requirements, payer: string, payerSig: string | null, deadlineMs?: number): Promise<{ amount: number; failed: boolean }> {
    const seen = { failed: false };   // per call (the instance is shared across concurrent requests)
    const amount = await this.checkTx(sig, h, payer, payerSig, deadlineMs, seen);
    return { amount, failed: amount === 0 && seen.failed };
  }

  private async checkTx(sig: string, h: X402Requirements, payer: string, payerSig: string | null, deadlineMs: number | undefined, seen: { failed: boolean }): Promise<number> {
    type PIx = { programId?: string; program?: string; parsed?: unknown; accounts?: string[]; data?: string };
    type Bal = { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string } };
    type Tx = { meta: { err: unknown; innerInstructions?: { instructions: PIx[] }[]; preTokenBalances?: Bal[]; postTokenBalances?: Bal[]; loadedAddresses?: { writable?: unknown[]; readonly?: unknown[] } } | null; transaction: { signatures: string[]; message: { accountKeys: { pubkey: string }[]; instructions: PIx[]; addressTableLookups?: unknown[] } } };
    if (!isSolanaSig(sig)) return 0;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = Date.now() + (deadlineMs ?? this.o.rpcDeadlineMs ?? SOLANA_FINALIZE_DEADLINE_MS);
    let tx: Tx | null = null;
    for (;;) {
      tx = (await this.rpc("getTransaction", [sig, { encoding: "jsonParsed", commitment: SOLANA_COMMITMENT, maxSupportedTransactionVersion: 0 }])) as Tx | null;
      if (tx) break;
      if (Date.now() >= deadline) return 0;
      await sleep(1_000);
    }
    const sigs = tx.transaction?.signatures ?? [];
    if (tx.meta && tx.meta.err !== null && tx.meta.err !== undefined && sigs[0] === sig) { seen.failed = true; return 0; }
    if (!tx.meta || tx.meta.err !== null) return 0;
    if (sigs[0] !== sig || (payerSig !== null && !sigs.includes(payerSig))) return 0; // payerSig null = re-check of a recorded settlement (G6); authority = payer still required      // the settled tx is the one the payer signed
    if ((tx.transaction.message.addressTableLookups ?? []).length) return 0;
    // SF8: no accounts loaded from lookup tables either (a v0 tx can carry them in meta even when the message list looks empty).
    const la = tx.meta.loadedAddresses;
    if (la && ((la.writable ?? []).length || (la.readonly ?? []).length)) return 0;
    let want: bigint; try { want = BigInt(h.amount); } catch { return 0; }
    const ata = this.payToAta, mint = this.o.net.asset, memo = (h.extra as { memo?: string }).memo;
    const all: PIx[] = [...(tx.transaction.message.instructions ?? []), ...(tx.meta.innerInstructions ?? []).flatMap((x) => x.instructions ?? [])];
    let hits = 0, ok = false, memos = 0;
    for (const ix of all) {
      const prog = ix.program ?? "";
      if (prog === "spl-memo" || ix.programId === MEMO_PROGRAM) { memos++; if (ix.parsed !== memo) return 0; continue; }
      const p = ix.parsed as { type?: string; info?: Record<string, unknown> } | undefined;
      const info = p?.info ?? {};
      // Only token-program instructions (top-level or CPI) can move SPL tokens; Lighthouse assertions may read the account.
      const tokenIx = prog === "spl-token" || prog === "spl-token-2022" || ix.programId === TOKEN_PROGRAM || ix.programId === TOKEN_2022_PROGRAM;
      const touches = Object.values(info).some((v) => v === ata) || (ix.accounts ?? []).includes(ata);
      if (!tokenIx || !touches) continue;
      hits++;
      const amt = (info.tokenAmount as { amount?: string } | undefined)?.amount;
      ok = prog === "spl-token" && ix.programId === TOKEN_PROGRAM && p?.type === "transferChecked" && info.destination === ata && info.mint === mint && info.authority === payer && amt === want.toString();
    }
    if (hits !== 1 || !ok || memos !== 1) return 0;
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
    const idx = keys.indexOf(ata);
    // SF4: exactly one pre AND one post balance entry for payTo's token account (pinned mint, owner = payTo, Tokenkeg). A missing
    // entry is never read as zero (that would let a freshly created or closed account fake the delta).
    const bal = (arr: Bal[] | undefined): bigint | null => {
      const hit = (arr ?? []).filter((x) => x.accountIndex === idx);
      // #103 S6: and the entry belongs to the classic SPL Token program (Tokenkeg), never Token-2022.
      if (hit.length !== 1 || hit[0].mint !== mint || hit[0].owner !== this.o.payTo || hit[0].programId !== TOKEN_PROGRAM) return null;
      try { return BigInt(hit[0].uiTokenAmount.amount); } catch { return null; }
    };
    const pre = bal(tx.meta.preTokenBalances), post = bal(tx.meta.postTokenBalances);
    if (idx < 0 || pre === null || post === null || post - pre !== want) return 0;
    const n = Number(want);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  }
}


/**
 * The Solana rail from env, or null (Base only). Off unless RENTALS_SOLANA_ENABLED=1.
 * Network follows RENTALS_X402_NETWORK: Base Sepolia -> Solana devnet (x402.org); Base mainnet -> Solana mainnet (CDP),
 * which also requires mainnetEnabled(). RENTALS_SOLANA_RPC (Sensitive: may carry a provider key) overrides the public RPC;
 * https only. security review #101 F2: on MAINNET it is required and must not be the public api.mainnet-beta endpoint (which
 * rate-limits): no keyed RPC = Solana off. RENTALS_SOLANA_FEE_PAYER optionally pins the facilitator sponsor: a different /supported answer turns Solana off.
 */
export function solanaFromEnv(env: Record<string, string | undefined>, mainnetOk: boolean, payToPins: PayToPins = PAYTO_PIN_SHA256): SolanaExact | null {
  if (env.RENTALS_SOLANA_ENABLED !== "1") return null;
  const mainnet = env.RENTALS_X402_NETWORK === "mainnet";
  if (mainnet && !mainnetOk) return null;
  const base = mainnet ? SOLANA_MAINNET : SOLANA_DEVNET;
  const rpc = env.RENTALS_SOLANA_RPC || base.rpc;
  try { if (new URL(rpc).protocol !== "https:") return null; } catch { return null; }
  if (mainnet && !keyedMainnetRpc(env.RENTALS_SOLANA_RPC)) return null;
  try {
    const payTo = solanaPayToFromEnv(env, payToPins.solana);
    if (!payTo) return null;
    return new SolanaExact({ net: { ...base, rpc }, payTo, payToPins, feePayerPin: env.RENTALS_SOLANA_FEE_PAYER || undefined,
      ...(base.auth === "cdp" ? { cdp: { keyId: env.CDP_API_KEY_ID ?? "", secret: env.CDP_API_KEY_SECRET ?? "" } } : {}) });
  } catch { return null; }
}

/**
 * SF1: mainnet RPC = an allowlisted keyed provider WITH its credential. Host match after stripping a trailing dot,
 * https only, default port, no userinfo, never an IP literal. Credential shapes per provider:
 *  - Helius:    mainnet.helius-rpc.com (pinned; #103 S1) ?api-key=<key>
 *  - Alchemy:   solana-mainnet.g.alchemy.com  /v2/<key>
 *  - QuickNode: <x>.solana-mainnet.quiknode.pro /<token>/
 *  - Triton:    <x>.mainnet.rpcpool.com       /<token>
 *  - Ankr:      rpc.ankr.com                  /solana/<key>
 */
const CRED = /^[A-Za-z0-9_-]{16,128}$/;
const MAINNET_RPC_PROVIDERS: { name: string; host: (h: string) => boolean; cred: (u: URL) => boolean }[] = [
  { name: "helius", host: (h) => h === "mainnet.helius-rpc.com", cred: (u) => CRED.test(u.searchParams.get("api-key") ?? "") },
  { name: "alchemy", host: (h) => h === "solana-mainnet.g.alchemy.com", cred: (u) => { const m = /^\/v2\/([^/]+)\/?$/.exec(u.pathname); return !!m && CRED.test(m[1]); } },
  { name: "quicknode", host: (h) => /^[a-z0-9-]+\.solana-mainnet\.quiknode\.pro$/.test(h), cred: (u) => { const m = /^\/([^/]+)\/?$/.exec(u.pathname); return !!m && CRED.test(m[1]); } },
  { name: "triton", host: (h) => /^[a-z0-9-]+\.mainnet\.rpcpool\.com$/.test(h), cred: (u) => { const m = /^\/([^/]+)\/?$/.exec(u.pathname); return !!m && CRED.test(m[1]); } },
  { name: "ankr", host: (h) => h === "rpc.ankr.com", cred: (u) => { const m = /^\/solana\/([^/]+)\/?$/.exec(u.pathname); return !!m && CRED.test(m[1]); } },
];
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\]|.*:.*)$/;
/** The allowlisted provider a mainnet RPC URL belongs to (with a credential), or null. */
export function mainnetRpcProvider(rpc: string | undefined): string | null {
  if (!rpc) return null;
  let u: URL; try { u = new URL(rpc); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || IP_LITERAL.test(host) || /^\d+$/.test(host)) return null;
  // #103 S1: never a devnet / testnet endpoint for mainnet, whatever the provider pattern says.
  if (/(^|[.-])(devnet|testnet)([.-]|$)/.test(host) || /devnet|testnet/i.test(u.pathname)) return null;
  const p = MAINNET_RPC_PROVIDERS.find((x) => x.host(host));
  return p && p.cred(u) ? p.name : null;
}
/** Mainnet needs an allowlisted keyed provider RPC (see mainnetRpcProvider). */
export function keyedMainnetRpc(rpc: string | undefined): boolean { return mainnetRpcProvider(rpc) !== null; }
