// Build the never-reveal env values from a PRIVATE terms file (never commit that file or the output).
//   npx tsx scripts/never-reveal-gen.ts <terms.json> <out.env> [--rotate]
// terms.json: {"output":[…],"copy":[…],"guard":[…],"sub":[…],"allow":[{"files":"<regex>","terms":[…]}]}
// out.env gets NEVER_REVEAL_KEY (64 hex, reused from an existing out.env unless --rotate) and NEVER_REVEAL_DIGESTS,
// written with mode 600. Prints counts only, never a term, key or digest. Paste the two values into GitHub Actions
// secrets and Vercel (Sensitive, server-only, never NEXT_PUBLIC).
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildNeverRevealDigests, parseNeverReveal } from "../src/lib/never-reveal";

const [termsPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!termsPath || !outPath) { console.error("usage: npx tsx scripts/never-reveal-gen.ts <terms.json> <out.env> [--rotate]"); process.exit(64); }
const T = JSON.parse(readFileSync(termsPath, "utf8")) as { output?: string[]; copy?: string[]; guard?: string[]; sub?: string[]; allow?: { files: string; terms: string[] }[] };

let keyHex = "";
if (!process.argv.includes("--rotate") && existsSync(outPath)) {
  keyHex = readFileSync(outPath, "utf8").match(/^NEVER_REVEAL_KEY=([0-9a-f]{64})$/m)?.[1] ?? "";
}
if (!keyHex) keyHex = randomBytes(32).toString("hex");

const json = buildNeverRevealDigests(Buffer.from(keyHex, "hex"), T);
const cfg = parseNeverReveal(keyHex, json);
if (!cfg) throw new Error("generated values failed to parse");
if (json.includes("'")) throw new Error("unexpected quote in digest JSON");
writeFileSync(outPath, `NEVER_REVEAL_KEY=${keyHex}\nNEVER_REVEAL_DIGESTS='${json}'\n`, { mode: 0o600 });
chmodSync(outPath, 0o600);
console.log(`never-reveal-gen: wrote ${outPath} (output ${cfg.output.size}, copy ${cfg.copy.size}, guard ${cfg.guard.size}, sub ${[...cfg.sub.values()].reduce((n, s) => n + s.size, 0)}, allow rules ${cfg.allow.length}; DIGESTS ${json.length} chars)`);
