/** CAIP-2 Bitcoin chain ids (bip122 + genesis-hash prefix), pinned per profile (PLAN §18.5). No imports: jobs.ts uses this. */
export const BTC_MAINNET_NETWORK = "bip122:000000000019d6689c085ae165831e93";
export const BTC_SIGNET_NETWORK = "bip122:00000008819873e925422c1ff0f99f7c";
/** Job env -> the ONE network a btc_onchain job may carry (rev 1.7, J22/J23). Anything else -> undefined. */
export function btcNetworkForEnv(env: unknown): string | undefined {
  return env === "mainnet" ? BTC_MAINNET_NETWORK : env === "staging" ? BTC_SIGNET_NETWORK : undefined;
}
/** bech32 human-readable part per network. */
export function btcHrpForNetwork(network: unknown): "bc" | "tb" | undefined {
  return network === BTC_MAINNET_NETWORK ? "bc" : network === BTC_SIGNET_NETWORK ? "tb" : undefined;
}
