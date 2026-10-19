/**
 * Synthetic receive addresses for the tests (scripts/test.env) and the sha256 pins that go with them. Production code
 * pins the real hashes in src/lib/rentals/phase2/payto-pins.ts; tests pass these as a parameter (never through env).
 */
import { sha256Hex, type PayToPins } from "../../src/lib/rentals/phase2/payto-pins";

export const TEST_PAYTO_EVM: string = process.env.RENTALS_PAYTO_PIN_EVM ?? "";
export const TEST_PAYTO_SOLANA: string = process.env.RENTALS_PAYTO_PIN_SOLANA ?? "";
if (!TEST_PAYTO_EVM || !TEST_PAYTO_SOLANA) throw new Error("run the tests with --env-file=scripts/test.env");
export const TEST_PAYTO_PINS: PayToPins = Object.freeze({ evm: sha256Hex(TEST_PAYTO_EVM), solana: sha256Hex(TEST_PAYTO_SOLANA) });
