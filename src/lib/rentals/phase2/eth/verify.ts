/**
 * Independent on-chain check for one Ethereum USDC transfer (eth_* JSON-RPC, keyed provider). No signing, no keys,
 * read-only. Every answer is a fixed shape; RPC text is never echoed and the RPC URL is never logged.
 *
 * A tx MATCHES a quote only when ALL hold:
 *  - eth_chainId equals the configured chain (wrong-chain provider = fail closed);
 *  - the receipt exists, its transactionHash is the one asked for, status is 0x1;
 *  - among the receipt's non-removed logs emitted by the pinned USDC contract, EXACTLY ONE is
 *    Transfer(from, to = payTo, value) and its value equals the quoted amount EXACTLY (BigInt);
 *  - the receipt's block is canonical (eth_getBlockByNumber(n).hash = receipt.blockHash).
 * It is FINAL only when that block is at or below the "finalized" tag AND at least ETH_MIN_CONFIRMATIONS deep.
 */
import { ETH_MIN_CONFIRMATIONS, type EthNet } from "./config";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
/** Customer input: 0x + 64 hex, any case. Stored and compared lowercase. */
export function normTxHash(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return TX_HASH_RE.test(t) ? t : null;
}

export type Want = { net: EthNet; payTo: string; amountAtomic: number };
export type TxSeen =
  | { kind: "rpc_error" }
  | { kind: "not_found" }
  | { kind: "unstable" }
  /** status 0x0. final = its block is canonical, at or below "finalized" and 12+ deep (finality-backed failure). */
  | { kind: "reverted"; final: boolean }
  | { kind: "no_match"; reason: "no_transfer_to_payto" | "multiple_transfers" }
  | { kind: "no_match"; reason: "amount_mismatch"; amountAtomic?: number; payer: string; blockNumber: number }
  | { kind: "match"; payer: string; amountAtomic: number; logIndex: number; blockNumber: number; blockHash: string; blockTimeMs: number; confirmations: number; final: boolean };

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
/** JSON-RPC over fetch: no redirects, 5 s per call, no cache. Throws a fixed error (never the URL or the body). */
export function makeRpc(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): Rpc {
  let id = 0;
  return async (method, params) => {
    let res: Response;
    try {
      res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new Error("eth_rpc_unavailable"); }
    if (!res.ok) throw new Error("eth_rpc_unavailable");
    const j = (await res.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
    if (!j || j.error !== undefined || !("result" in j)) throw new Error("eth_rpc_error");
    return j.result;
  };
}

const HEX_QTY = /^0x[0-9a-f]{1,64}$/i;
const big = (x: unknown): bigint | null => (typeof x === "string" && HEX_QTY.test(x) ? BigInt(x) : null);
const pad32 = (addr: string) => "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
type Log = { address?: string; topics?: string[]; data?: string; removed?: boolean; logIndex?: string };
type Receipt = { transactionHash?: string; status?: string; blockNumber?: string; blockHash?: string; logs?: Log[] };
type Block = { number?: string; hash?: string; timestamp?: string };

export async function inspectEthTx(rpc: Rpc, txHash: string, want: Want): Promise<TxSeen> {
  const tx = normTxHash(txHash);
  if (!tx) return { kind: "not_found" };
  try {
    if (String(await rpc("eth_chainId", [])).toLowerCase() !== want.net.chainIdHex) return { kind: "rpc_error" };
    const rc = (await rpc("eth_getTransactionReceipt", [tx])) as Receipt | null;
    if (!rc) return { kind: "not_found" };
    if (String(rc.transactionHash ?? "").toLowerCase() !== tx) return { kind: "rpc_error" };
    const bn = big(rc.blockNumber);
    const bh = String(rc.blockHash ?? "").toLowerCase();
    if (rc.status === "0x0") {
      if (bn === null || !/^0x[0-9a-f]{64}$/.test(bh)) return { kind: "reverted", final: false };
      const at = await canonicalAt(rpc, want.net, Number(bn), true);
      return { kind: "reverted", final: !!at && at.hash === bh && at.finalized && at.confirmations >= ETH_MIN_CONFIRMATIONS };
    }
    // A receipt without a status (or any other value) is not evidence of anything: fail closed, never "reverted".
    if (rc.status !== "0x1") return { kind: "rpc_error" };
    if (bn === null || !/^0x[0-9a-f]{64}$/.test(bh)) return { kind: "unstable" };
    const asset = want.net.asset.toLowerCase(), to = pad32(want.payTo);
    const hits = (rc.logs ?? []).filter((l) => l && l.removed !== true && String(l.address ?? "").toLowerCase() === asset
      && Array.isArray(l.topics) && l.topics.length === 3 && String(l.topics[0]).toLowerCase() === TRANSFER_TOPIC && String(l.topics[2]).toLowerCase() === to);
    if (hits.length === 0) return { kind: "no_match", reason: "no_transfer_to_payto" };
    if (hits.length > 1) return { kind: "no_match", reason: "multiple_transfers" };
    const l = hits[0];
    const v = big(l.data);
    const li = big(l.logIndex);
    if (v === null || li === null) return { kind: "rpc_error" };
    const fromTopic = String(l.topics![1]).toLowerCase();
    if (!/^0x0{24}[0-9a-f]{40}$/.test(fromTopic)) return { kind: "rpc_error" };
    const payer = "0x" + fromTopic.slice(26);
    if (v !== BigInt(want.amountAtomic)) return { kind: "no_match", reason: "amount_mismatch", amountAtomic: v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : undefined, payer, blockNumber: Number(bn) };
    const blk = (await rpc("eth_getBlockByNumber", ["0x" + bn.toString(16), false])) as Block | null;
    if (!blk || String(blk.hash ?? "").toLowerCase() !== bh) return { kind: "unstable" };   // receipt from a block that is no longer canonical
    const ts = big(blk.timestamp);
    const head = big(await rpc("eth_blockNumber", []));
    const fin = (await rpc("eth_getBlockByNumber", ["finalized", false])) as Block | null;
    const finN = big(fin?.number);
    if (ts === null || head === null || head < bn) return { kind: "unstable" };
    const confirmations = Number(head - bn + BigInt(1));
    const final = finN !== null && bn <= finN && confirmations >= ETH_MIN_CONFIRMATIONS;
    return { kind: "match", payer, amountAtomic: Number(v), logIndex: Number(li), blockNumber: Number(bn), blockHash: bh, blockTimeMs: Number(ts) * 1000, confirmations, final };
  } catch { return { kind: "rpc_error" }; }
}

/**
 * The canonical block at height n and whether n is finalized (n <= "finalized" tag). Used for finality-backed negatives:
 * a recorded claim whose block was finalized and is now a DIFFERENT block was reorged out of a finalized range (or the
 * claim was wrong), which is the only way a missing receipt becomes terminal. null on any doubt.
 */
export async function canonicalAt(rpc: Rpc, net: EthNet, n: number, chainChecked = false): Promise<{ hash: string; finalized: boolean; confirmations: number } | null> {
  try {
    if (!chainChecked && String(await rpc("eth_chainId", [])).toLowerCase() !== net.chainIdHex) return null;
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    const blk = (await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), false])) as Block | null;
    const fin = (await rpc("eth_getBlockByNumber", ["finalized", false])) as Block | null;
    const head = big(await rpc("eth_blockNumber", []));
    const finN = big(fin?.number);
    const h = String(blk?.hash ?? "").toLowerCase();
    if (!blk || !/^0x[0-9a-f]{64}$/.test(h) || finN === null || head === null || big(blk.number) !== BigInt(n)) return null;
    return { hash: h, finalized: BigInt(n) <= finN, confirmations: Number(head - BigInt(n) + BigInt(1)) };
  } catch { return null; }
}

/** Wrap an Rpc with a wall-clock deadline: calls after it throw (the sweep's budget then holds per call, not per claim). */
export function withDeadline(rpc: Rpc, deadlineMs: number, clock: () => number = Date.now): Rpc {
  return async (m, p) => { if (clock() >= deadlineMs) throw new Error("eth_rpc_deadline"); return rpc(m, p); };
}
