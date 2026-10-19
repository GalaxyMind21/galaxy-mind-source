/**
 * Customer-facing payment rails. Same check as the checkout's Solana picker (human.ts solanaOffered:
 * RENTALS_SOLANA_ENABLED=1 and a buildable rail), so copy never promises a rail the page doesn't offer.
 * Server only. /hashrate is ISR (revalidate 300): its copy can lag a flag change by up to 5 minutes.
 */
import { solanaOffered } from "./phase2/human";
import { PAYTO_PIN_SHA256, type PayToPins } from "./phase2/payto-pins";

type Env = Record<string, string | undefined>;
export const solanaRailOn = (env: Env = process.env, payToPins: PayToPins = PAYTO_PIN_SHA256) => solanaOffered(env, payToPins);
/** "USDC on Base or Solana" when Solana is offered, otherwise "USDC on Base". */
export const payRailsLabel = (env: Env = process.env, payToPins: PayToPins = PAYTO_PIN_SHA256) => (solanaRailOn(env, payToPins) ? "USDC on Base or Solana" : "USDC on Base");
