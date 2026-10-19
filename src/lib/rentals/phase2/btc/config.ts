/**
 * BTC on-chain rail: flag, per-profile pins and the descriptor boot check (PLAN v3.1 §2, §7, §9.5, §18.5).
 *
 * Everything here FAILS CLOSED. The rail is usable only when ALL of these hold:
 *   - RENTALS_BTC_ONCHAIN_ENABLED=1 (default unset = off; never set in Production until the owner's go-live yes);
 *   - the profile's descriptor pins are set IN SOURCE (fingerprint, checksum, sha256 of /0/0, /0/1, /0/2);
 *   - BTC_ONCHAIN_DESCRIPTOR (Vercel env, Sensitive; mainnet value Production-only) parses, matches the profile
 *     (xpub + 84h/0h/0h on mainnet, tpub + 84h/1h/0h on staging) and matches every pin;
 *   - the profile has at least one attestation key (kid -> Ed25519 SPKI) pinned IN SOURCE (never an env var, §7);
 *   - Turnstile is configured (TURNSTILE_SECRET_KEY + NEXT_PUBLIC_TURNSTILE_SITE_KEY): BTC never degrades to "no captcha".
 *
 * The profile follows the signed-job env (flag.ts jobEnv): mainnet only behind every mainnet gate, else staging.
 * Prod accepts only the Bitcoin mainnet CAIP-2 id; staging accepts only its pinned test chain (signet) (§18.5).
 *
 * Mainnet receive wallet: the descriptor (with its xpub) lives only in BTC_ONCHAIN_DESCRIPTOR. Its pins stay IN SOURCE:
 * they are a fingerprint, a checksum and address hashes, which don't reveal the xpub, and keeping them here means env
 * write access alone can never redirect BTC payments to another wallet. /0/0 of the wallet is reserved and never shown
 * to a customer (customer addresses start at index 1, N5).
 *
 * VALUES THAT DON'T EXIST YET (fail closed until a reviewed source PR adds them):
 *   - BTC_ATTEST_KEYS.mainnet["node-btc-1"]: the SPKI PEM printed by the root key generation on the node (§7).
 *   - BTC_ATTEST_KEYS.staging: a staging agent key, if a signet end-to-end run is wanted.
 */
import { parseDescriptor, deriveReceive, sha256Hex, type ParsedDescriptor } from "./hd";
import { jobEnv } from "../flag";

type Env = Record<string, string | undefined>;
export type BtcProfile = "mainnet" | "staging";

import { BTC_MAINNET_NETWORK, BTC_SIGNET_NETWORK } from "./networks";
export { BTC_MAINNET_NETWORK, BTC_SIGNET_NETWORK, btcNetworkForEnv, btcHrpForNetwork } from "./networks";
export const BTC_NETWORK_BY_PROFILE: Record<BtcProfile, string> = { mainnet: BTC_MAINNET_NETWORK, staging: BTC_SIGNET_NETWORK };

export type DescriptorPins = { fingerprint: string; checksum: string; addrSha256: readonly [string, string, string] };

/**
 * Descriptor pins per profile, IN SOURCE. A mismatch refuses the rail.
 * staging: a THROWAWAY signet descriptor = the public BIP39 test mnemonic ("abandon … about") at m/84'/1'/0'
 *   (fingerprint 73c5da0a). Its keys are public on purpose: signet coins only, never real money. Addresses cross-checked
 *   with bip_utils 2.12.2 (independent library) and in scripts/test-btc-rail.ts.
 * mainnet: null in this copy (mainnet refuses). Pin your own watch-only wallet with generated pins (do not hand-edit). The checksum pin covers the EXACT env
 *   string, apostrophe form (the h form of the same keys has a different checksum and is refused). Mainnet still
 *   refuses while BTC_ATTEST_KEYS.mainnet is empty.
 */
export const BTC_PINS: Record<BtcProfile, DescriptorPins | null> = {
  // Export copy: no mainnet wallet is pinned. Generate the pins for your own watch-only wallet.
  mainnet: null,
  staging: {
    fingerprint: "73c5da0a",
    checksum: "evh9fu0w",
    addrSha256: [
      "10fc8211179dd8b4ed4564f8c8fdb86acf5496d418e29eabba1256dc51413983", // /0/0 tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl (reserved, never shown)
      "63b6aadb1cd630b536ad1baf1854fece72dde7e211d6c7af8c6fb95a1b4e71ec", // /0/1 tb1qd7spv5q28348xl4myc8zmh983w5jx32cjhkn97
      "8be2ed2d66a4af25bba66b7e79749fe8da1bbcf5c791878d6c10aee3bf503894", // /0/2 tb1qxdyjf6h5d6qxap4n2dap97q4j5ps6ua8sll0ct
    ],
  },
};
/** The staging descriptor value (public test keys; set it as BTC_ONCHAIN_DESCRIPTOR in Preview to exercise the rail). */
export const STAGING_TEST_DESCRIPTOR = "wpkh([73c5da0a/84h/1h/0h]tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)#evh9fu0w";

/** kid -> Ed25519 SPKI PEM of the node gm-btc-agent, IN SOURCE (PLAN §7). Empty = no envelope verifies = BTC off. */
export const BTC_ATTEST_KEYS: Record<BtcProfile, Readonly<Record<string, string>>> = {
  mainnet: {},
  staging: {},
};

/** Public tip endpoints (P5): tip height ONLY, server-side, never an address/txid/scripthash. */
export const BTC_PUBLIC_TIP_URLS: Record<BtcProfile, readonly string[]> = {
  mainnet: ["https://mempool.space/api/blocks/tip/height", "https://blockstream.info/api/blocks/tip/height"],
  staging: ["https://mempool.space/signet/api/blocks/tip/height"],
};

export function btcFlag(env: Env = process.env): boolean { return env.RENTALS_BTC_ONCHAIN_ENABLED === "1"; }
export function btcProfile(env: Env = process.env): BtcProfile { return jobEnv(env) === "mainnet" ? "mainnet" : "staging"; }

export type BtcBootError =
  | "btc_flag_off" | "btc_production_not_mainnet" | "btc_pins_unset" | "btc_no_attest_key" | "btc_turnstile_unset"
  | "btc_profile_mismatch" | "btc_pin_fingerprint" | "btc_pin_checksum" | "btc_pin_address" | "btc_derive_failed"
  | import("./hd").DescriptorError;

export type BtcReady = {
  profile: BtcProfile;
  network: string;
  hrp: "bc" | "tb";
  descriptor: ParsedDescriptor;
  keys: Readonly<Record<string, string>>;
  tipUrls: readonly string[];
  turnstileSiteKey: string;
};

/**
 * Boot check against the source pins (no network). Same checks as the agent and the poller (§2): wrong key type,
 * wrong depth/child, fingerprint or path mismatch, checksum mismatch and any of the three pinned addresses.
 */
export function checkDescriptor(raw: string | undefined, profile: BtcProfile, pins: DescriptorPins | null = BTC_PINS[profile]):
  { ok: true; d: ParsedDescriptor } | { ok: false; error: BtcBootError } {
  if (!pins) return { ok: false, error: "btc_pins_unset" };
  const p = parseDescriptor(raw);
  if (!p.ok) return { ok: false, error: p.error };
  const d = p.d;
  const want = profile === "mainnet" ? { v: "xpub", coin: 0 } : { v: "tpub", coin: 1 };
  if (d.keyVersion !== want.v || d.coin !== want.coin) return { ok: false, error: "btc_profile_mismatch" };
  if (d.fingerprint !== pins.fingerprint) return { ok: false, error: "btc_pin_fingerprint" };
  if (d.checksum !== pins.checksum) return { ok: false, error: "btc_pin_checksum" };
  try {
    for (let i = 0; i < 3; i++) if (sha256Hex(deriveReceive(d, i)) !== pins.addrSha256[i]) return { ok: false, error: "btc_pin_address" };
  } catch { return { ok: false, error: "btc_derive_failed" }; }
  return { ok: true, d };
}

let bootCache: { key: string; r: { ok: true; ready: BtcReady } | { ok: false; error: BtcBootError } } | null = null;
/** Full gate: flag, pins, descriptor, attestation key, Turnstile. Cached per (profile, descriptor). Never logs the descriptor. */
export function btcConfig(env: Env = process.env, over: { pins?: DescriptorPins | null; keys?: Readonly<Record<string, string>> } = {}):
  { ok: true; ready: BtcReady } | { ok: false; error: BtcBootError } {
  if (!btcFlag(env)) return { ok: false, error: "btc_flag_off" };
  const profile = btcProfile(env);
  // SF6: staging pins are a PUBLIC test mnemonic. Vercel Production never runs the staging profile, whatever else is set.
  if (env.VERCEL_ENV === "production" && profile !== "mainnet") return { ok: false, error: "btc_production_not_mainnet" };
  const keys = over.keys ?? BTC_ATTEST_KEYS[profile];
  if (!keys || Object.keys(keys).length === 0) return { ok: false, error: "btc_no_attest_key" };
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  if (!env.TURNSTILE_SECRET_KEY || !siteKey) return { ok: false, error: "btc_turnstile_unset" };
  const raw = env.BTC_ONCHAIN_DESCRIPTOR;
  const cacheable = over.pins === undefined && over.keys === undefined;
  const key = `${profile}|${raw ?? ""}|${siteKey}`;
  if (cacheable && bootCache?.key === key) return bootCache.r;
  const c = checkDescriptor(raw, profile, over.pins === undefined ? BTC_PINS[profile] : over.pins);
  const r = c.ok
    ? { ok: true as const, ready: { profile, network: BTC_NETWORK_BY_PROFILE[profile], hrp: (profile === "mainnet" ? "bc" : "tb") as "bc" | "tb", descriptor: c.d, keys, tipUrls: BTC_PUBLIC_TIP_URLS[profile], turnstileSiteKey: siteKey } }
    : { ok: false as const, error: c.error };
  if (cacheable) bootCache = { key, r };
  return r;
}
