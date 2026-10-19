// Test helpers for the keyed never-reveal list (src/lib/never-reveal.ts).
// Tests never see the real list. They prove the machinery with SYNTHETIC terms under their own random key, registered
// next to whatever NEVER_REVEAL_KEY / NEVER_REVEAL_DIGESTS the environment carries (none in CI or locally by default).
import { randomBytes } from "node:crypto";
import {
  buildNeverRevealDigests, containsNeverReveal, parseNeverReveal, registerExtraNeverReveal, type NeverRevealConfig,
} from "../../src/lib/never-reveal";

/** Synthetic stand-ins: a place, a hosting company (also written as two words), and a customer handle. */
export const SYNTH = { place: "Exampleland", host: "Acmehostco", hostSplit: "Acmehost Co", customer: "zzrenter" } as const;

/** A config for the synthetic terms with a fresh random key. */
export function syntheticNeverReveal(extraTerms: { output?: string[]; guard?: string[]; sub?: string[]; allow?: { files: string; terms: string[] }[] } = {}): NeverRevealConfig {
  const keyHex = randomBytes(32).toString("hex");
  const base = [SYNTH.place, SYNTH.host, SYNTH.customer];
  const json = buildNeverRevealDigests(Buffer.from(keyHex, "hex"), {
    output: [...base, ...(extraTerms.output ?? [])],
    copy: [...base, ...(extraTerms.output ?? [])],
    guard: [...base, ...(extraTerms.guard ?? [])],
    sub: extraTerms.sub,
    allow: extraTerms.allow,
  });
  const cfg = parseNeverReveal(keyHex, json);
  if (!cfg) throw new Error("synthetic never-reveal config failed to parse");
  return cfg;
}

let registered: NeverRevealConfig | null = null;
/** Register the synthetic terms (call once at the top of a test file). Idempotent. */
export function useSyntheticNeverReveal(): NeverRevealConfig {
  if (!registered) { registered = syntheticNeverReveal(); registerExtraNeverReveal(registered); }
  return registered;
}

/** True when text names any never-reveal term in the repo-guard scope (real list if configured, plus synthetic). */
export function leaksNeverReveal(text: string): boolean {
  return containsNeverReveal(text, "guard");
}
/** Same, plus the customer-output scope (use on prose, where short words never mean something else). */
export function leaksNeverRevealStrict(text: string): boolean {
  return containsNeverReveal(text, ["guard", "output"]);
}
