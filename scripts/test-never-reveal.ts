// Keyed never-reveal list (src/lib/never-reveal.ts). In-process, no network. Synthetic terms and random keys only.
// If NEVER_REVEAL_KEY / NEVER_REVEAL_DIGESTS are set (the private values), the env config is also checked to parse.
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NR from "../src/lib/never-reveal";
import { normalizeForFilter, blockedHit, isBlockedTerm, neverRevealFailClosed, neverRevealHit } from "../src/lib/rentals";
import { SYNTH, useSyntheticNeverReveal, syntheticNeverReveal } from "./lib/never-reveal-test";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean) => { if (ok) pass++; else { fail++; console.error(`  ✗ ${n}`); } };

const k1 = randomBytes(32), k2 = randomBytes(32);
assert("digest is 24 hex, deterministic and case/punctuation-insensitive", /^[0-9a-f]{24}$/.test(NR.digestTerm(k1, "x")) && NR.digestTerm(k1, "Acme-Host") === NR.digestTerm(k1, "acmehost") && NR.digestTerm(k1, "x") !== NR.digestTerm(k1, "y"));
assert("the key matters (a digest can't be tested without it)", NR.digestTerm(k1, "acmehost") !== NR.digestTerm(k2, "acmehost"));
assert("tokenizer keeps IPv4 whole and snake_case joined", JSON.stringify(NR.tokenize("ip 192.0.2.7 pending_review US-South")) === JSON.stringify(["ip", "192.0.2.7", "pendingreview", "us", "south"]));

// Parsing: malformed input is refused, never thrown.
const goodKey = k1.toString("hex");
const goodJson = NR.buildNeverRevealDigests(k1, { output: ["a1"], guard: ["a1"] });
assert("a valid pair parses", !!NR.parseNeverReveal(goodKey, goodJson));
for (const [n, k, j] of [
  ["short key", "abcd", goodJson], ["non-hex key", "z".repeat(64), goodJson], ["bad json", goodKey, "{"], ["wrong version", goodKey, '{"v":2}'],
  ["bad digest", goodKey, '{"v":1,"output":["zz"]}'], ["bad sub length", goodKey, '{"v":1,"sub":{"x":[]}}'], ["bad allow regex", goodKey, '{"v":1,"allow":[{"files":"(","d":[]}]}'],
  ["unanchored allow (no ^)", goodKey, '{"v":1,"allow":[{"files":"src/x\\\\.ts$","d":[]}]}'], ["unanchored allow (no $)", goodKey, '{"v":1,"allow":[{"files":"^src/x","d":[]}]}'],
  ["unanchored allow (escaped $)", goodKey, '{"v":1,"allow":[{"files":"^src/x\\\\$","d":[]}]}'],
] as const) assert(`refused: ${n}`, NR.parseNeverReveal(k, j) === null);
{
  const anch = NR.parseNeverReveal(goodKey, JSON.stringify({ v: 1, allow: [{ files: "^src/a\\.ts|src/b\\.ts$", d: [] }, { files: "^(public/llms\\.txt|src/c/[^/]+)$", d: [] }] }));
  const [alt, grp] = anch?.allow ?? [];
  assert("anchored allow rules parse and match only exact paths", !!alt && !!grp && grp.files.test("public/llms.txt") && !grp.files.test("public/llms.txt.bak") && grp.files.test("src/c/page.tsx") && !grp.files.test("src/c/d/page.tsx"));
  assert("a top-level alternation can't escape the anchors", alt.files.test("src/a.ts") && alt.files.test("src/b.ts") && !alt.files.test("src/a.ts.bak") && !alt.files.test("x/src/b.ts"));
}
assert("status: unconfigured / invalid / configured", NR.neverRevealStatus({}) === "unconfigured" && NR.neverRevealStatus({ NEVER_REVEAL_KEY: "x" }) === "invalid" && NR.neverRevealStatus({ NEVER_REVEAL_KEY: goodKey, NEVER_REVEAL_DIGESTS: goodJson }) === "configured");

// Missing env: matcher is empty; a deployment in direct mode fails closed; mrr_only and local runs don't.
assert("no configs = no match", !NR.containsNeverReveal(`hosted at ${SYNTH.host}`, "output", []));
assert("fail closed: deployed + direct + unset", neverRevealFailClosed({ VERCEL_ENV: "production", RENTALS_MODE: "direct" }) && neverRevealHit("anything at all", { VERCEL_ENV: "preview", RENTALS_MODE: "direct" }));
assert("fail closed: deployed + direct + malformed", neverRevealFailClosed({ VERCEL_ENV: "production", RENTALS_MODE: "direct", NEVER_REVEAL_KEY: "x", NEVER_REVEAL_DIGESTS: "{}" }));
assert("not fail closed: deployed + direct + configured", !neverRevealFailClosed({ VERCEL_ENV: "production", RENTALS_MODE: "direct", NEVER_REVEAL_KEY: goodKey, NEVER_REVEAL_DIGESTS: goodJson }));
assert("not fail closed: mrr_only (default) or local", !neverRevealFailClosed({ VERCEL_ENV: "production" }) && !neverRevealFailClosed({ RENTALS_MODE: "direct" }));

// Synthetic terms (the same path the real list takes, under a different key).
assert("nothing synthetic matches before registration", !NR.containsNeverReveal(`hosted at ${SYNTH.host}`));
useSyntheticNeverReveal();
for (const s of [SYNTH.place, `US-${SYNTH.place} #25`, SYNTH.host, SYNTH.hostSplit, `${SYNTH.customer}.w1`, SYNTH.customer.toUpperCase()]) {
  assert(`synthetic hit: ${s}`, NR.containsNeverReveal(s));
  assert(`customer filter blocks: ${s}`, !!blockedHit(JSON.stringify({ note: s })) && isBlockedTerm(s));
}
assert("homoglyph + zero-width variants still hit after normalizeForFilter", NR.containsNeverReveal(normalizeForFilter("Еxample\u200Bland")) && NR.containsNeverReveal(normalizeForFilter("Ａｃｍｅｈｏｓｔ Ｃｏ")));
for (const s of ["Galaxy Mind", "US-based (US South)", "pending_review", "Rentals are closed", "txid pending", "an example of land"]) assert(`no false positive: ${s}`, !NR.containsNeverReveal(s, ["guard", "output"]));
assert("hits never carry the matched text", JSON.stringify(NR.findNeverReveal(SYNTH.host)).indexOf(SYNTH.host.toLowerCase()) === -1);

// Scopes, substring windows and two configs with different keys side by side.
const c2 = syntheticNeverReveal({ output: ["zzshort"], guard: ["zzguardonly", "zzsubterm"], sub: ["zzsubterm"] });
assert("guard-only term is not an output hit", NR.containsNeverReveal("zzguardonly", "guard", [c2]) && !NR.containsNeverReveal("zzguardonly", "output", [c2]));
assert("sub term matches inside a longer token", NR.containsNeverReveal("xxzzsubtermyy", "guard", [c2]) && !NR.containsNeverReveal("xxzzshortyy", "output", [c2]));
NR.registerExtraNeverReveal(c2);
assert("two registered configs both apply", NR.containsNeverReveal("zzshort") && NR.containsNeverReveal(SYNTH.customer));
NR.clearExtraNeverReveal();
assert("clearing removes registered configs", !NR.containsNeverReveal("zzshort") && !NR.containsNeverReveal(SYNTH.customer));
NR.registerExtraNeverReveal(useSyntheticNeverReveal());

// Repo guard on long tokens (scripts/check-never-reveal.ts), run in a throwaway git repo with a test-only key and
// synthetic terms. A token over 64 chars used to skip every check, including the sub windows.
{
  const tk = randomBytes(32);
  const longTerm = "zzlongterm" + "q".repeat(70);
  const subWord = "zzsecretword";
  const cfgJson = NR.buildNeverRevealDigests(tk, { guard: [longTerm, subWord], sub: [subWord] });
  const dir = mkdtempSync(join(tmpdir(), "nr-long-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const snake = ["build", "artifact", "for", "the", "staging", "pipeline", subWord, "with", "extra", "padding", "words", "here"].join("_");
    writeFileSync(join(dir, "a.ts"), [`const x = "${longTerm}";`, `const ${snake} = 1;`, "const clean_but_quite_long_identifier_name_that_goes_past_sixty_four_chars = 2;"].join("\n"));
    execFileSync("git", ["add", "-A"], { cwd: dir });
    let out = "";
    try {
      execFileSync("npx", ["tsx", join(process.cwd(), "scripts/check-never-reveal.ts"), "--require"], {
        cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NEVER_REVEAL_KEY: tk.toString("hex"), NEVER_REVEAL_DIGESTS: cfgJson },
      });
      out = "ok";
    } catch (e) { out = String((e as { stderr?: string }).stderr ?? ""); }
    const flagged = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("a.ts:"));
    assert("guard flags a whole token over 64 chars", snake.replace(/_/g, "").length > 64 && flagged.includes("a.ts:1"));
    assert("guard flags a blocked sub word inside a long snake_case token", flagged.includes("a.ts:2"));
    assert("a long clean identifier is not flagged", !flagged.includes("a.ts:3") && flagged.length === 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Optional: the real values, if present in the environment (never printed).
const st = NR.neverRevealStatus();
if (st !== "unconfigured") {
  assert("env never-reveal config parses", st === "configured");
  console.log(`  (env never-reveal config: ${st})`);
}

console.log(`test-never-reveal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
