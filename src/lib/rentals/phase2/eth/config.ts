/**
 * USDC on Ethereum (ERC-20) · DIRECT TRANSFER rail · config. Fails closed: null unless every gate holds.
 *
 * No x402 facilitator we trust covers Ethereum mainnet (CDP has no eip155:1; PrimeV has no sanctions screening), so
 * this rail is a plain ERC-20 transfer the customer sends from their own wallet (they pay Ethereum gas) and that we
 * verify ourselves on-chain with a keyed RPC. Human checkout only in v1.
 *
 * Gates (ALL required):
 *  - RENTALS_ETH_USDC_ENABLED=1
 *  - RENTALS_ETH_PAYTO: the receive address, in its exact EIP-55 form, non-zero, and its sha256 must equal the EVM pin
 *    in code (PAYTO_PIN_SHA256.evm, payto-pins.ts; the same pin as Base). Unset or refused = the rail cannot turn on.
 *  - RENTALS_ETH_RPC: mainnet = an allowlisted keyed provider (Alchemy, Infura, QuickNode, Ankr). Sensitive, server-only,
 *    never NEXT_PUBLIC, never logged. Sepolia (staging) may fall back to a public endpoint.
 *  - RENTALS_ETH_NODE_READY=1: set only once the node job verifier accepts eip155:1 route jobs (job schema bump). Until
 *    then a paid ETH order would be refused by the node at schema_network and end as a manual refund.
 *  - Network follows Base: Base Sepolia -> Ethereum Sepolia; Base mainnet (mainnetEnabled) -> Ethereum mainnet.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { mainnetEnabled } from "../flag";
import { PAYTO_PIN_SHA256, verifiedPayTo, evmPayToFromEnv } from "../payto-pins";

type Env = Record<string, string | undefined>;

export type EthNet = {
  network: "eip155:1" | "eip155:11155111";
  chainIdHex: "0x1" | "0xaa36a7";
  name: string;
  /** Circle USDC (FiatTokenV2), 6 decimals. Pinned in code. */
  asset: string;
  explorer: string;
  testnet: boolean;
};
export const ETH_MAINNET: EthNet = { network: "eip155:1", chainIdHex: "0x1", name: "Ethereum", asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", explorer: "https://etherscan.io", testnet: false };
export const ETH_SEPOLIA: EthNet = { network: "eip155:11155111", chainIdHex: "0xaa36a7", name: "Ethereum Sepolia", asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", explorer: "https://sepolia.etherscan.io", testnet: true };
export const ETH_NETWORKS: ReadonlySet<string> = new Set([ETH_MAINNET.network, ETH_SEPOLIA.network]);
export const ethNetFor = (network: string): EthNet | null => (network === ETH_MAINNET.network ? ETH_MAINNET : network === ETH_SEPOLIA.network ? ETH_SEPOLIA : null);
/** Public Sepolia endpoint for staging only (mainnet never falls back to a public RPC). */
export const SEPOLIA_PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * The ONE address Ethereum USDC may be paid to: RENTALS_ETH_PAYTO, accepted only when it hashes to the EVM pin (the
 * same address as Base; the operator confirmed it on 2026-10-17). For resolving claims after the rail is switched off
 * (RENTALS_ETH_PAYTO removed), RENTALS_PAYTO_PIN_EVM is accepted under the same pin. null = neither passes: ethConfig()
 * null, no quotes, claims never resolve, ethLookup never reads paid (fail closed). The SQL twin
 * public.rental_eth_payto_pin() (migration 20261017211000) must return a string with this same sha256; change both
 * together (rotation rule: move the old address into ETH_PAYTO_HISTORY and the new hash into payto-pins.ts).
 * Pinning does not turn the rail on (RENTALS_ETH_USDC_ENABLED).
 */
export function ethPayToFromEnv(env: Env = process.env, pinSha: string | null = PAYTO_PIN_SHA256.evm): string | null {
  return verifiedPayTo("evm", env.RENTALS_ETH_PAYTO, pinSha, env) || null;
}
/** The address existing quotes and claims are judged against (see ethPayToFromEnv). */
export function ethPinFromEnv(env: Env = process.env, pinSha: string | null = PAYTO_PIN_SHA256.evm): string | null {
  return ethPayToFromEnv(env, pinSha) ?? (evmPayToFromEnv(env, pinSha) || null);
}
/**
 * Every address that was EVER the pin, oldest first (append-only; empty today). Rotation rule:
 * to change the pin, move the old address into this list in the SAME PR that sets the new pin and the SQL pin.
 * Never remove an entry: quotes, claims and settlements made to it must keep resolving and reading as paid. A
 * historical address is never used for a NEW quote (bind and ethConfig accept only the current pin).
 */
export const ETH_PAYTO_HISTORY: readonly string[] = [];
/**
 * Problems with a pin history (test-eth-rail checks the real one is clean): every entry must be a valid EIP-55 payTo,
 * no address may appear twice (case-insensitive), and the current pin must not also be in the history.
 */
export function payToHistoryProblems(history: readonly string[], pin: string | null): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const a of history) {
    if (!validPayTo(a)) out.push(`invalid:${a}`);
    const k = String(a).toLowerCase();
    if (seen.has(k)) out.push(`duplicate:${a}`);
    seen.add(k);
    if (pin && k === pin.toLowerCase()) out.push(`current_pin:${a}`);
  }
  return out;
}

/** Payment refs for this rail. Distinct from x402_ refs, so the x402 pay route can never touch them. */
export const ETH_REF_RE = /^eth_[0-9a-f]{32}$/;
export const isEthRef = (ref: string) => ETH_REF_RE.test(ref);

/** Settlement gate: the block must be at or below the "finalized" tag AND at least this deep (belt and braces). */
export const ETH_MIN_CONFIRMATIONS = 12;
/** Binding tag: a unique cent amount added to the order price, 1..99 cents (USDC 6dp: 10_000 atomic per cent). */
export const ETH_TAG_UNIT = 10_000;
export const ETH_TAG_MIN = 1;
export const ETH_TAG_MAX = 99;
/** A tag stays reserved this long after the pay window, so a late payment still maps to exactly one order. */
export const ETH_RESERVE_AFTER_MS = 2 * 60 * 60_000;
/** Picking Ethereum needs at least this much of the 15-minute window left (an L1 transfer takes a minute or two). */
export const ETH_MIN_WINDOW_MS = 3 * 60_000;
/**
 * Accept a block a little before the quote was made. PoS block timestamps are slot-exact (12 s slots) and the quote's
 * created_at is the DB clock at bind, so this only covers clock skew; kept small so nobody can bind a fresh quote to
 * the exact amount of an unrelated transfer they just saw land on payTo.
 */
export const ETH_CLOCK_SKEW_MS = 15_000;
/** After the pay window, the sweep keeps an order open this long while its Ethereum quote is live, so the customer can paste the hash. */
export const ETH_CLAIM_GRACE_MS = 10 * 60_000;
/** An order with an unresolved claim is never expired by the sweep before this (finality is ~13-15 min). */
export const ETH_HOLD_MAX_MS = 2 * 60 * 60_000;
/** Unresolved this long: one alert + manual review. */
export const ETH_STUCK_MS = 45 * 60_000;
/** Re-checks per ref are cached this long (polls can't become an RPC storm). */
export const ETH_RECHECK_CACHE_MS = 10_000;

const ADDR = /^0x[0-9a-fA-F]{40}$/;
/** EIP-55 checksum (same algorithm as x402.ts toChecksum; duplicated to keep this folder self-contained). */
export function eip55(addr: string): string {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const h = Buffer.from(keccak_256(new TextEncoder().encode(a))).toString("hex");
  return "0x" + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}
/** A payTo must be a non-zero address written in its exact EIP-55 form (a typo in one letter fails the checksum). */
export function validPayTo(a: string | null | undefined): a is string {
  return !!a && ADDR.test(a) && eip55(a) === a && !/^0x0{40}$/i.test(a);
}

/**
 * Allowlisted keyed Ethereum RPC providers. https only, no userinfo, default port, no IP literal; the credential sits
 * in the path. eth_chainId is checked at runtime too, so a provider URL for the wrong chain fails closed.
 *  - Alchemy:   eth-mainnet.g.alchemy.com /v2/<key>   (Sepolia: eth-sepolia.g.alchemy.com)
 *  - Infura:    mainnet.infura.io /v3/<key>           (Sepolia: sepolia.infura.io)
 *  - QuickNode: <x>.quiknode.pro /<token>/            (chain from the endpoint; checked by eth_chainId)
 *  - Ankr:      rpc.ankr.com /eth/<key>               (Sepolia: /eth_sepolia/<key>)
 */
const CRED = /^[A-Za-z0-9_-]{16,128}$/;
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\]|.*:.*)$/;
type Prov = { name: string; host: (h: string, main: boolean) => boolean; cred: (u: URL, main: boolean) => boolean };
const path1 = (re: RegExp) => (u: URL) => { const m = re.exec(u.pathname); return !!m && CRED.test(m[1]); };
const PROVIDERS: Prov[] = [
  { name: "alchemy", host: (h, main) => h === (main ? "eth-mainnet.g.alchemy.com" : "eth-sepolia.g.alchemy.com"), cred: path1(/^\/v2\/([^/]+)\/?$/) },
  { name: "infura", host: (h, main) => h === (main ? "mainnet.infura.io" : "sepolia.infura.io"), cred: path1(/^\/v3\/([^/]+)\/?$/) },
  { name: "quicknode", host: (h) => /^[a-z0-9-]+(\.[a-z0-9-]+)?\.quiknode\.pro$/.test(h), cred: path1(/^\/([^/]+)\/?$/) },
  { name: "ankr", host: (h) => h === "rpc.ankr.com", cred: (u, main) => path1(main ? /^\/eth\/([^/]+)\/?$/ : /^\/eth_sepolia\/([^/]+)\/?$/)(u) },
];
/** The provider name of an allowlisted keyed RPC URL, or null. Never returns or logs the URL itself. */
export function ethRpcProvider(rpc: string | undefined, main: boolean): string | null {
  if (!rpc) return null;
  let u: URL; try { u = new URL(rpc); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || u.hash) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || IP_LITERAL.test(host) || /^\d+$/.test(host)) return null;
  // A mainnet RPC is never a testnet endpoint, whatever the provider pattern says (and vice versa).
  const testy = /(sepolia|holesky|goerli|testnet|devnet)/i;
  if (main && (testy.test(host) || testy.test(u.pathname))) return null;
  const p = PROVIDERS.find((x) => x.host(host, main));
  return p && p.cred(u, main) ? p.name : null;
}

export type EthConfig = { net: EthNet; payTo: string; rpc: string; rpcProvider: string };

/** RENTALS_ETH_NODE_READY = "1": the node side is ready for this rail. */
const nodeReady = (env: Env) => env.RENTALS_ETH_NODE_READY;

/** Flag only (cheap, sync): is the rail switched on at all? */
export const ethFlag = (env: Env = process.env) => env.RENTALS_ETH_USDC_ENABLED === "1";

/**
 * Full config, or null (rail off). Never throws, never echoes env values.
 * `main` = the deployment's Base network is mainnet (mainnetEnabled). Sepolia otherwise.
 */
export function ethConfig(env: Env = process.env, pinSha: string | null = PAYTO_PIN_SHA256.evm): EthConfig | null {
  if (!ethFlag(env)) return null;
  if (nodeReady(env) !== "1") return null;
  const payTo = ethPayToFromEnv(env, pinSha);
  if (!payTo || !validPayTo(payTo)) return null;
  const main = env.RENTALS_X402_NETWORK === "mainnet";
  if (main && !mainnetEnabled(env)) return null;
  const v = ethVerifyConfig(env);
  if (!v) return null;
  return { ...v, payTo };
}

export type EthVerifyConfig = { net: EthNet; rpc: string; rpcProvider: string };
/**
 * The READ side only (chain + RPC), independent of the on/off flag and payTo: claims already recorded keep being
 * resolved (and the sweep hold keeps their orders open) after the rail is switched off. Never creates quotes.
 */
export function ethVerifyConfig(env: Env = process.env): EthVerifyConfig | null {
  const main = env.RENTALS_X402_NETWORK === "mainnet";
  const net = main ? ETH_MAINNET : ETH_SEPOLIA;
  let rpc = env.RENTALS_ETH_RPC ?? "";
  let prov = ethRpcProvider(rpc, main);
  if (!prov && !main && !rpc) { rpc = SEPOLIA_PUBLIC_RPC; prov = "publicnode-sepolia"; }
  if (!prov) return null;
  return { net, rpc, rpcProvider: prov };
}

/** Customer amount for a tag: price + tag cents. Integer atomic units only. */
export function taggedAmount(baseAtomic: number, tag: number): number {
  if (!Number.isSafeInteger(baseAtomic) || baseAtomic <= 0) throw new Error("bad_base");
  if (!Number.isInteger(tag) || tag < ETH_TAG_MIN || tag > ETH_TAG_MAX) throw new Error("bad_tag");
  return baseAtomic + tag * ETH_TAG_UNIT;
}
/** "123.450000" -> exact 6dp decimal string for display and wallets. */
export const usdc6 = (atomic: number) => `${Math.floor(atomic / 1e6)}.${String(atomic % 1e6).padStart(6, "0")}`;
/** Display with cents: tags are whole cents and order prices are whole cents, so 2dp is exact ("123.45"). */
export function usdc2(atomic: number): string {
  if (atomic % ETH_TAG_UNIT !== 0) return usdc6(atomic);
  return `${Math.floor(atomic / 1e6)}.${String((atomic % 1e6) / ETH_TAG_UNIT).padStart(2, "0")}`;
}
