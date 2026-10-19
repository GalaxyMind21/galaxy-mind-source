/**
 * Browser-safe helpers for the Ethereum USDC step (no node imports, no secrets). Pure, so scripts/test-eth-rail.ts covers them.
 */
export const ETH_COPY = {
  pickerNote: "Any Ethereum wallet. You pay gas.",
  gasNote: "You pay Ethereum gas for this transfer, so the network fee comes from your wallet on top of the amount below.",
  tagNote: "The last cents are unique to your order. They are how we match your payment to you, so please send this exact amount.",
  exchangeNote: "Sending from an exchange? Choose the Ethereum network (ERC-20), and make sure the amount that arrives is exactly this one after any withdrawal fee.",
  waitingTitle: "Waiting for Ethereum to see your payment",
  waitingBody: "As soon as your transfer is in a block, we start confirming it. You can keep this page open.",
  confirmingTitle: "Confirming on Ethereum",
  confirmingBody: "Your payment is on-chain. We wait until Ethereum finalizes it, which usually takes about 15 minutes, and then your rigs switch to your pool.",
} as const;

/** Fixed error codes from /api/rentals/eth -> warm, complete sentences. charged: did money (maybe) move? */
export function ethErrorCopy(code: string | null | undefined): { title: string; body: string; charged: "no" | "maybe" } {
  switch (code) {
    case "window_too_short": return { title: "Not enough time left for Ethereum", body: "An Ethereum transfer needs a few minutes, and this price expires very soon. Pay on another network, or start again for a fresh price.", charged: "no" };
    case "rail_busy": return { title: "Ethereum is busy right now", body: "Please pay on another network for now, or try Ethereum again in a little while. Nothing was charged.", charged: "no" };
    case "rail_unavailable": return { title: "USDC on Ethereum isn't available right now", body: "Please pay with USDC on another network, or with Bitcoin if this order offers it. Nothing was charged.", charged: "no" };
    case "no_capacity": return { title: "Those rigs were just taken", body: "Not enough rigs are free for this order right now, so we stopped before showing you an address to pay. Nothing was charged. Please try again in a minute, or start over with fewer rigs.", charged: "no" };
    case "not_payable": return { title: "This order can't take a payment", body: "It may already be paid, cancelled or expired. Check your rental below, or start again.", charged: "no" };
    case "invalid_tx_hash": return { title: "That doesn't look like a transaction hash", body: "It should start with 0x followed by 64 letters and numbers. You can copy it from your wallet's activity or from Etherscan.", charged: "no" };
    case "tx_failed": return { title: "That transaction failed on-chain", body: "Ethereum reverted it, so no USDC moved. Please send the payment again.", charged: "no" };
    case "no_matching_transfer": return { title: "We couldn't find your payment in that transaction", body: "It doesn't send USDC to the address above. Please check the hash, or send the exact amount to the address shown.", charged: "no" };
    case "amount_mismatch": return { title: "The amount doesn't match exactly", body: "That transfer reached us, but not for this order's exact amount, so we can't match it automatically. We've been notified and will sort it out by hand. Please message us with your rental ID.", charged: "maybe" };
    case "tx_before_quote": return { title: "That transaction is older than this order", body: "Please send a new payment for this order's exact amount, then paste its hash.", charged: "no" };
    case "outside_window": return { title: "That payment arrived after this order closed", body: "We've been notified and will sort it out by hand, including a refund if it's due. Please message us with your rental ID.", charged: "maybe" };
    case "tx_already_used": return { title: "That transaction is already used", body: "Each payment can only pay one order. Please check the hash.", charged: "no" };
    case "rate_limited": return { title: "Too many tries", body: "Please wait a minute and try again.", charged: "no" };
    default: return { title: "Something went wrong", body: "Please try again in a moment. If you already sent the payment, it is safe: paste the hash again and we'll pick it up.", charged: "maybe" };
  }
}

const hex32 = (n: bigint) => n.toString(16).padStart(64, "0");
/** calldata for ERC-20 transfer(to, amount): selector a9059cbb + 32-byte address + 32-byte amount. */
export function erc20TransferData(to: string, amountAtomic: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to) || !/^[1-9][0-9]{0,30}$/.test(amountAtomic)) throw new Error("bad_transfer");
  return "0xa9059cbb" + hex32(BigInt(to)) + hex32(BigInt(amountAtomic));
}
export const etherscanTx = (explorer: string, tx: string) => `${explorer.replace(/\/$/, "")}/tx/${tx}`;
